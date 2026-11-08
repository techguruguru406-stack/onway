// Shared helpers + header/footer injection
const $=s=>document.querySelector(s);
const api=async(u,o={})=>{const t=localStorage.token;o.headers={...(o.body&&!(o.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(t?{Authorization:'Bearer '+t}:{}),...o.headers};
 if(o.body&&!(o.body instanceof FormData))o.body=JSON.stringify(o.body);const r=await fetch(u,o);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Error');return d};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.body.insertAdjacentHTML('afterbegin',`<header><a class="logo" href="/">On<b>Way</b> ➤</a><nav><a href="/ship.html">Ship</a><a href="/track.html">Track</a><a href="/support.html">Support</a><a href="${localStorage.token?'/dashboard.html':'/login.html'}">${localStorage.token?'Account':'Login'}</a></nav></header>`);
document.body.insertAdjacentHTML('beforeend','<footer>© OnWay — Delivered On Time. Every Time.</footer><a class="btn" style="position:fixed;right:14px;bottom:14px;background:#25D366" href="https://wa.me/2340000000000">WhatsApp</a>');
// Footer links + FAQ/chat widget
document.querySelector('footer').insertAdjacentHTML('afterbegin','<p><a href="/about.html">About</a> · <a href="/careers.html">Careers</a> · <a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a> · <a href="/support.html">Support</a> · <a href="/locations.html">Locations</a></p>');
document.body.insertAdjacentHTML('beforeend',`<div id="cw" style="position:fixed;left:14px;bottom:14px;z-index:20"><button id="cb" style="background:var(--p)">Chat</button><div id="cx" hidden style="background:#fff;border:1px solid #ccc;border-radius:12px;padding:1rem;width:260px;margin-bottom:.5rem;box-shadow:0 4px 20px #0003"><b>OnWay Support</b><p>Hi! Leave your email and message; we reply by email. Track a parcel on the Track page.</p><input id="ce" placeholder="Email" type="email"><textarea id="cm" placeholder="Message"></textarea><button id="cs">Send</button><p id="cr"></p></div></div>`);
$('#cb').onclick=()=>$('#cx').hidden=!$('#cx').hidden;
$('#cs').onclick=async()=>{try{await api('/api/contact',{method:'POST',body:{name:'Chat',email:$('#ce').value,message:$('#cm').value}});$('#cr').textContent='Sent ✔'}catch(e){$('#cr').textContent=e.message}};
