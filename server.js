// OnWay API + static server. JSON-file DB (no native deps, works on Termux).
const fs=require('fs'),path=require('path'),express=require('express'),bcrypt=require('bcryptjs'),
jwt=require('jsonwebtoken'),multer=require('multer'),nodemailer=require('nodemailer');
try{fs.readFileSync('.env','utf8').split('\n').forEach(l=>{const m=l.match(/^(\w+)=(.*)$/);if(m)process.env[m[1]]??=m[2]})}catch{}
const {PORT=3000,JWT_SECRET='dev-secret'}=process.env;
const DBF='data/db.json';
const db=fs.existsSync(DBF)?JSON.parse(fs.readFileSync(DBF)):{users:[],shipments:[],fees:[],payments:[],quotes:[],pickups:[]};
const save=()=>fs.writeFileSync(DBF,JSON.stringify(db,null,1));
const id=(p)=>p+Math.random().toString(36).slice(2,8).toUpperCase();
if(!db.users.find(u=>u.role==='admin')){db.users.push({id:id('U'),name:'Admin',role:'admin',
 email:process.env.ADMIN_EMAIL||'admin@onway.com',hash:bcrypt.hashSync(process.env.ADMIN_PASSWORD||'ChangeMe123!',10)});save()}
const mail=process.env.SMTP_HOST?nodemailer.createTransport({host:process.env.SMTP_HOST,port:587,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}):null;
const notify=(to,subject,text)=>{console.log('[EMAIL]',to,subject);mail&&mail.sendMail({from:'OnWay <'+process.env.SMTP_USER+'>',to,subject,text}).catch(console.error)};
const app=express();app.disable('x-powered-by');
app.use((q,r,n)=>{r.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin'});n()});
app.use(express.json({limit:'100kb',verify:(q,r,b)=>{q.raw=b}}));
const hits={};const limit=(max,ms)=>(q,r,n)=>{const k=q.ip+q.path,t=Date.now();hits[k]=(hits[k]||[]).filter(x=>t-x<ms);if(hits[k].length>=max)return r.status(429).json({error:'Too many attempts. Try again later.'});hits[k].push(t);n()};
app.use('/api/auth',limit(10,15*60e3));app.use('/api/contact',limit(5,60e3));app.use(express.static('public'));
const up=multer({dest:'uploads/',limits:{fileSize:5e6},fileFilter:(r,f,cb)=>cb(null,/image|pdf/.test(f.mimetype))});
const auth=(req,res,next)=>{try{req.user=jwt.verify((req.headers.authorization||'').slice(7),JWT_SECRET);next()}catch{res.status(401).json({error:'Login required'})}};
const admin=(q,s,n)=>auth(q,s,()=>q.user.role==='admin'?n():s.status(403).json({error:'Admins only'}));
const req_=(o,k)=>k.every(x=>o[x]!==undefined&&String(o[x]).trim()!=='');
// ---- Auth
app.post('/api/auth/signup',(q,s)=>{const b=q.body;if(!req_(b,['name','email','password'])||b.password.length<8||!/^\S+@\S+\.\S+$/.test(b.email))return s.status(400).json({error:'Valid name, email and 8+ char password required'});
 if(db.users.find(u=>u.email===b.email.toLowerCase()))return s.status(409).json({error:'Email already used'});
 const u={id:id('U'),name:b.name,email:b.email.toLowerCase(),role:'user',hash:bcrypt.hashSync(b.password,10),addresses:[]};db.users.push(u);save();
 s.json({token:jwt.sign({id:u.id,role:u.role,email:u.email},JWT_SECRET,{expiresIn:'7d'}),role:u.role})});
app.post('/api/auth/login',(q,s)=>{const u=db.users.find(x=>x.email===String(q.body.email).toLowerCase());
 if(!u||!bcrypt.compareSync(String(q.body.password),u.hash))return s.status(401).json({error:'Invalid credentials'});
 s.json({token:jwt.sign({id:u.id,role:u.role,email:u.email},JWT_SECRET,{expiresIn:'7d'}),role:u.role})});
// ---- Quote (multi-currency; base price in USD)
const SVC={express:{base:25,kg:6,days:'1-2'},standard:{base:12,kg:3,days:'3-5'},international:{base:45,kg:12,days:'4-7'},freight:{base:90,kg:2,days:'7-14'},sameday:{base:35,kg:5,days:'Same day'}};
const FX={USD:1,NGN:1550,GBP:0.79,EUR:0.92};
app.post('/api/quote',(q,s)=>{const b=q.body,v=SVC[b.service];if(!v||!req_(b,['origin','destination','weight']))return s.status(400).json({error:'Origin, destination, weight, service required'});
 const vol=((b.l||1)*(b.w||1)*(b.h||1))/5000,kg=Math.max(+b.weight,vol);const usd=v.base+kg*v.kg;
 const cur=FX[b.currency]?b.currency:'USD';db.quotes.push({id:id('Q'),...b,at:new Date()});save();
 s.json({price:+(usd*FX[cur]).toFixed(2),currency:cur,days:v.days})});
// ---- Shipments
const stages=['Order Received','Picked Up','In Transit','Out for Delivery','Delivered'];
const ev=(status,location)=>({status,location,at:new Date().toISOString()});
const mk=(b,owner)=>{const sh={id:'OW'+Date.now().toString().slice(-8)+Math.floor(Math.random()*90+10),owner,sender:b.sender,receiver:b.receiver,pkg:b.pkg,service:b.service,
 email:b.email,status:stages[0],events:[ev(stages[0],b.sender?.city||'Origin')]};db.shipments.push(sh);save();return sh};
app.post('/api/shipments',auth,(q,s)=>{const b=q.body;if(!b.sender||!b.receiver||!SVC[b.service])return s.status(400).json({error:'Sender, receiver, service required'});
 const sh=mk({...b,email:q.user.email},q.user.id);notify(q.user.email,'OnWay shipment '+sh.id,'Your tracking ID is '+sh.id);s.json(sh)});
app.get('/api/my/shipments',auth,(q,s)=>s.json(db.shipments.filter(x=>x.owner===q.user.id)));
app.get('/api/my/payments',auth,(q,s)=>{const mine=db.shipments.filter(x=>x.owner===q.user.id).map(x=>x.id);s.json(db.payments.filter(p=>mine.includes(p.shipmentId)))});
const view=(sh)=>({...sh,fees:db.fees.filter(f=>f.shipmentId===sh.id)});
app.get('/api/track/:id',(q,s)=>{const sh=db.shipments.find(x=>x.id===q.params.id.trim().toUpperCase());sh?s.json(view({...sh,sender:undefined,receiver:{city:sh.receiver?.city},email:undefined})):s.status(404).json({error:'Tracking ID not found'})});
app.post('/api/pickups',(q,s)=>{if(!req_(q.body,['address','date','window']))return s.status(400).json({error:'Missing fields'});db.pickups.push({id:id('P'),...q.body});save();s.json({ok:true})});
// ---- Admin
app.get('/api/admin/all',admin,(q,s)=>s.json({shipments:db.shipments.map(view),users:db.users.map(({hash,...u})=>u),quotes:db.quotes,pickups:db.pickups,messages:db.messages||[],payments:db.payments,fees:db.fees}));
app.post('/api/admin/shipments',admin,(q,s)=>s.json(mk(q.body,null)));
app.patch('/api/admin/shipments/:id',admin,(q,s)=>{const sh=db.shipments.find(x=>x.id===q.params.id);if(!sh||!stages.includes(q.body.status))return s.status(400).json({error:'Bad request'});
 sh.status=q.body.status;sh.events.push(ev(q.body.status,q.body.location||''));save();
 if(sh.email)notify(sh.email,'Shipment '+sh.id+': '+sh.status,'Status: '+sh.status+' at '+(q.body.location||''));s.json(sh)});
app.post('/api/admin/shipments/:id/fees',admin,(q,s)=>{const b=q.body;if(!db.shipments.find(x=>x.id===q.params.id)||!req_(b,['title','amount','currency']))return s.status(400).json({error:'Title, amount, currency required'});
 const f={id:id('F'),shipmentId:q.params.id,title:b.title,description:b.description||'',amount:+b.amount,currency:b.currency,status:'Pending',due:b.due||null};db.fees.push(f);save();const sh0=db.shipments.find(x=>x.id===f.shipmentId);if(sh0.email)notify(sh0.email,'Payment required – '+sh0.id,f.title+': '+f.amount+' '+f.currency+'. Open the tracking page to pay.');s.json(f)});
app.patch('/api/admin/fees/:id',admin,(q,s)=>{const f=db.fees.find(x=>x.id===q.params.id);if(!f)return s.sendStatus(404);
 for(const k of['title','description','amount','currency','status','due'])if(q.body[k]!==undefined)f[k]=q.body[k];save();s.json(f)});
app.patch('/api/admin/payments/:id',admin,(q,s)=>{const p=db.payments.find(x=>x.id===q.params.id);if(!p)return s.sendStatus(404);
 p.status=q.body.approve?'Approved':'Rejected';const f=db.fees.find(x=>x.id===p.feeId);
 if(q.body.approve){f.status='Paid';paid(p,f)}save();s.json(p)});
app.get('/api/admin/payments.csv',admin,(q,s)=>{s.type('text/csv').send('id,shipment,fee,amount,currency,method,status,date\n'+db.payments.map(p=>[p.id,p.shipmentId,p.feeId,p.amount,p.currency,p.method,p.status,p.at].join(',')).join('\n'))});
app.get('/uploads/:f',admin,(q,s)=>s.sendFile(path.resolve('uploads',path.basename(q.params.f))));
// ---- Fee payments (customer side; card via Paystack, bank transfer proof, crypto)
function paid(p,f){const sh=db.shipments.find(x=>x.id===f.shipmentId);sh.events.push(ev('Payment received: '+f.title,''));save();
 if(sh.email)notify(sh.email,'Payment confirmed – '+sh.id,'We received '+f.amount+' '+f.currency+' for '+f.title+'. Receipt: /api/receipts/'+p.id)}
app.get('/api/pay/info',(q,s)=>s.json({bank:process.env.BANK_DETAILS||'',card:!!process.env.PAYSTACK_SECRET}));
app.post('/api/fees/:id/card',async(q,s)=>{const f=db.fees.find(x=>x.id===q.params.id);const sh=f&&db.shipments.find(x=>x.id===f.shipmentId);
 if(!f||f.status!=='Pending'||!process.env.PAYSTACK_SECRET||!sh?.email)return s.status(400).json({error:'Card payments not available'});
 const r=await(await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:'Bearer '+process.env.PAYSTACK_SECRET,'Content-Type':'application/json'},
 body:JSON.stringify({email:sh.email,amount:Math.round(f.amount*100),currency:f.currency,metadata:{feeId:f.id}})})).json();
 if(!r.status)return s.status(502).json({error:'Gateway error'});const p={id:id('PAY'),feeId:f.id,shipmentId:f.shipmentId,amount:f.amount,currency:f.currency,method:'card',status:'Initiated',ref:r.data.reference,at:new Date()};db.payments.push(p);save();s.json({url:r.data.authorization_url,ref:p.ref})});
app.get('/api/fees/verify/:ref',async(q,s)=>{const p=db.payments.find(x=>x.ref===q.params.ref);if(!p)return s.sendStatus(404);
 const r=await(await fetch('https://api.paystack.co/transaction/verify/'+p.ref,{headers:{Authorization:'Bearer '+process.env.PAYSTACK_SECRET}})).json();
 if(r.data?.status==='success'&&p.status!=='Approved'){p.status='Approved';const f=db.fees.find(x=>x.id===p.feeId);f.status='Paid';paid(p,f)}s.json({status:p.status,receipt:p.id})});
app.post('/api/fees/:id/proof',up.single('proof'),(q,s)=>{const f=db.fees.find(x=>x.id===q.params.id);if(!f||f.status!=='Pending'||!q.file)return s.status(400).json({error:'Upload an image or PDF'});
 const p={id:id('PAY'),feeId:f.id,shipmentId:f.shipmentId,amount:f.amount,currency:f.currency,method:q.body.method==='crypto'?'crypto':'bank',status:'Under Review',file:q.file.filename,at:new Date()};db.payments.push(p);save();s.json({ok:true,message:'Proof submitted. We will review it shortly.'})});
app.post('/api/fees/:id/giftcard',(q,s)=>{const f=db.fees.find(x=>x.id===q.params.id);const b=q.body||{};const code=String(b.code||'').trim().slice(0,100),type=String(b.type||'').trim().slice(0,40),amt=+b.amount;
 if(!f||f.status!=='Pending')return s.status(400).json({error:'Fee not payable'});
 if(code.length<4||!type||!(amt>0))return s.status(400).json({error:'Enter card type, amount and code'});
 const p={id:id('PAY'),feeId:f.id,shipmentId:f.shipmentId,amount:f.amount,currency:f.currency,method:'giftcard',status:'Under Review',giftType:type,giftAmount:amt,giftCode:code,at:new Date()};db.payments.push(p);save();s.json({ok:true,message:'Gift card submitted. We will verify it shortly.'})});
app.get('/api/receipts/:id',(q,s)=>{const p=db.payments.find(x=>x.id===q.params.id&&x.status==='Approved');if(!p)return s.status(404).send('Not found');
 const f=db.fees.find(x=>x.id===p.feeId);s.send(`<body style="font-family:sans-serif;max-width:480px;margin:2rem auto"><h1 style="color:#4D148C">OnWay Receipt</h1><p>Receipt: ${p.id}<br>Shipment: ${p.shipmentId}<br>For: ${f.title}<br>Amount: ${p.amount} ${p.currency}<br>Method: ${p.method}<br>Date: ${p.at}</p><button onclick="print()">Print / Save PDF</button></body>`)});

// ---- Phase 2: price helper, shipment payment/invoice, addresses, locations, contact
const priceOf=(b,cur='NGN')=>{const v=SVC[b.service];const kg=+b.weight||1;return +((v.base+kg*v.kg)*FX[cur]).toFixed(2)};
app.post('/api/shipments/full',auth,(q,s)=>{const b=q.body,cur=FX[b.currency]?b.currency:'NGN';
 if(!req_(b.sender||{},['name','address','city'])||!req_(b.receiver||{},['name','address','city'])||!SVC[b.service])return s.status(400).json({error:'Sender, receiver and service details required'});
 const sh=mk({...b,email:q.user.email},q.user.id);sh.price=priceOf({service:b.service,weight:b.pkg?.weight},cur);sh.currency=cur;
 sh.payMethod=['bank','cash'].includes(b.payMethod)?b.payMethod:'bank';save();
 notify(q.user.email,'OnWay shipment '+sh.id,'Tracking ID: '+sh.id+'. Amount: '+sh.price+' '+cur);s.json(sh)});
app.get('/api/my/shipments/:id',auth,(q,s)=>{const sh=db.shipments.find(x=>x.id===q.params.id&&x.owner===q.user.id);sh?s.json(sh):s.sendStatus(404)});
app.get('/api/my/addresses',auth,(q,s)=>s.json(db.users.find(u=>u.id===q.user.id).addresses||[]));
app.post('/api/my/addresses',auth,(q,s)=>{const u=db.users.find(x=>x.id===q.user.id);if(!req_(q.body,['label','address','city']))return s.status(400).json({error:'Label, address, city required'});
 (u.addresses??=[]).push({label:q.body.label,address:q.body.address,city:q.body.city});save();s.json(u.addresses)});
app.get('/api/invoices/:id',auth,(q,s)=>{const sh=db.shipments.find(x=>x.id===q.params.id&&(x.owner===q.user.id||q.user.role==='admin'));if(!sh||!sh.price)return s.status(404).send('Not found');
 s.send(`<body style="font-family:sans-serif;max-width:480px;margin:2rem auto"><h1 style="color:#4D148C">OnWay Invoice</h1><p>Shipment: ${esc(sh.id)}<br>Service: ${esc(sh.service)}<br>Amount: ${sh.price} ${sh.currency}<br>Payment: ${esc(sh.payMethod)}</p><button onclick="print()">Print</button></body>`)});
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// EDIT these sample drop-off points to your real ones
const LOCS=[{name:'OnWay Uyo Hub',city:'Uyo',address:'Aka Road, Uyo, Akwa Ibom',hours:'Mon-Sat 8am-6pm'},{name:'OnWay Lagos Ikeja',city:'Lagos',address:'Allen Avenue, Ikeja',hours:'Mon-Sat 8am-7pm'},{name:'OnWay Abuja Central',city:'Abuja',address:'Wuse II, Abuja',hours:'Mon-Fri 8am-6pm'},{name:'OnWay Port Harcourt',city:'Port Harcourt',address:'Aba Road, Port Harcourt',hours:'Mon-Sat 8am-6pm'}];
app.get('/api/locations',(q,s)=>{const t=String(q.query.q||'').toLowerCase();s.json(LOCS.filter(l=>(l.name+l.city+l.address).toLowerCase().includes(t)))});
db.messages??=[];
app.post('/api/contact',(q,s)=>{if(!req_(q.body,['name','email','message'])||!/^\S+@\S+\.\S+$/.test(q.body.email))return s.status(400).json({error:'Name, valid email and message required'});
 db.messages.push({id:id('M'),...q.body,at:new Date()});save();notify(process.env.ADMIN_EMAIL||'admin@onway.com','New contact message',q.body.message);s.json({ok:true})});

// ---- Phase 3: reset password, webhook, admin edit/delete, user mgmt, health
const crypto=require('crypto');
app.post('/api/auth/forgot',(q,s)=>{const u=db.users.find(x=>x.email===String(q.body.email).toLowerCase());
 if(u){const t=crypto.randomBytes(24).toString('hex');u.reset={h:crypto.createHash('sha256').update(t).digest('hex'),exp:Date.now()+36e5};save();
  notify(u.email,'Reset your OnWay password',(process.env.BASE_URL||'http://localhost:'+PORT)+'/reset.html?token='+t)}
 s.json({ok:true})});
app.post('/api/auth/reset',(q,s)=>{const h=crypto.createHash('sha256').update(String(q.body.token)).digest('hex');
 const u=db.users.find(x=>x.reset&&x.reset.h===h&&x.reset.exp>Date.now());if(!u||String(q.body.password).length<8)return s.status(400).json({error:'Invalid or expired link, or password too short'});
 u.hash=bcrypt.hashSync(q.body.password,10);delete u.reset;save();s.json({ok:true})});
app.post('/api/paystack/webhook',(q,s)=>{const sig=crypto.createHmac('sha512',process.env.PAYSTACK_SECRET||'x').update(q.raw||'').digest('hex');
 if(sig!==q.headers['x-paystack-signature'])return s.sendStatus(401);
 if(q.body.event==='charge.success'){const p=db.payments.find(x=>x.ref===q.body.data.reference);if(p&&p.status!=='Approved'){p.status='Approved';const f=db.fees.find(x=>x.id===p.feeId);f.status='Paid';paid(p,f)}}s.sendStatus(200)});
app.patch('/api/admin/shipments/:id/details',admin,(q,s)=>{const sh=db.shipments.find(x=>x.id===q.params.id);if(!sh)return s.sendStatus(404);
 for(const k of['sender','receiver','pkg','service','email'])if(q.body[k]!==undefined)sh[k]=q.body[k];save();s.json(sh)});
app.delete('/api/admin/shipments/:id',admin,(q,s)=>{db.shipments=db.shipments.filter(x=>x.id!==q.params.id);db.fees=db.fees.filter(f=>f.shipmentId!==q.params.id);save();s.json({ok:true})});
app.delete('/api/admin/fees/:id',admin,(q,s)=>{db.fees=db.fees.filter(f=>f.id!==q.params.id);save();s.json({ok:true})});
app.patch('/api/admin/users/:id',admin,(q,s)=>{const u=db.users.find(x=>x.id===q.params.id);if(!u)return s.sendStatus(404);if(['user','admin'].includes(q.body.role))u.role=q.body.role;save();s.json({ok:true})});
app.delete('/api/admin/users/:id',admin,(q,s)=>{if(q.params.id===q.user.id)return s.status(400).json({error:'Cannot delete yourself'});db.users=db.users.filter(x=>x.id!==q.params.id);save();s.json({ok:true})});
// ---- OnWay prepaid vouchers (issued by admin, redeemed against fees). Stored in data/db.json -> "vouchers"
db.vouchers??=[];
app.use('/api/fees',limit(15,15*60e3));
app.post('/api/admin/vouchers',admin,(q,s)=>{const amt=+q.body.amount,n=Math.min(Math.max(+q.body.count||1,1),100),cur=q.body.currency;
 if(!(amt>0)||!FX[cur])return s.status(400).json({error:'Valid amount and currency required'});
 const out=[];for(let i=0;i<n;i++){const c='OW-'+crypto.randomBytes(3).toString('hex').toUpperCase()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
  const v={code:c,balance:amt,initial:amt,currency:cur,created:new Date(),history:[]};db.vouchers.push(v);out.push(v)}save();s.json(out)});
app.get('/api/admin/vouchers',admin,(q,s)=>s.json(db.vouchers));
app.post('/api/fees/:id/voucher',(q,s)=>{const f=db.fees.find(x=>x.id===q.params.id);const v=db.vouchers.find(x=>x.code===String(q.body.code||'').trim().toUpperCase());
 if(!f||f.status!=='Pending')return s.status(400).json({error:'Fee not payable'});
 if(!v||v.currency!==f.currency||v.balance<f.amount)return s.status(400).json({error:'Invalid voucher, wrong currency or insufficient balance'});
 v.balance=+(v.balance-f.amount).toFixed(2);v.history.push({feeId:f.id,amount:f.amount,at:new Date()});
 const p={id:id('PAY'),feeId:f.id,shipmentId:f.shipmentId,amount:f.amount,currency:f.currency,method:'voucher',status:'Approved',at:new Date()};db.payments.push(p);f.status='Paid';paid(p,f);save();s.json({ok:true,receipt:p.id})});

app.get('/health',(q,s)=>s.json({ok:true}));
app.use('/api',(q,s)=>s.status(404).json({error:'Not found'}));
app.use((q,s)=>s.status(404).sendFile(path.resolve('public/404.html')));
app.use((e,q,s,n)=>{console.error(e);s.status(500).json({error:'Server error'})});

app.listen(PORT,()=>console.log('OnWay running on http://localhost:'+PORT));
