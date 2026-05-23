// ========== CONFIGURATION ==========
const API_GATEWAY = 'https://rtyfpyvqgvqozprquusx.supabase.co/functions/v1/api-gateway';
const AUTH_GATEWAY = 'https://rtyfpyvqgvqozprquusx.supabase.co/functions/v1/auth-gateway';
const TMDB_KEY = '35647da404eda7b8b77497d758251d69';
const T = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

// ========== 🔥 مصادر الفيديو بنفس طريقة Novacast (بدون إعلانات) ==========
const SRCS = [
  // 1. VidFast مع theme=FF006E
  (tp,id,s,e)=>tp==='movie'
    ? `https://vidfast.pro/movie/${id}?theme=FF006E`
    : `https://vidfast.pro/tv/${id}/${s}/${e}?theme=FF006E`,
  // 2. VidScr (vidsrc-embed.ru)
  (tp,id,s,e)=>tp==='movie'
    ? `https://vidsrc-embed.ru/embed/movie/${id}`
    : `https://vidsrc-embed.ru/embed/tv/${id}/${s}-${e}`,
  // 3. VideoEasy مع color و episodeSelector
  (tp,id,s,e)=>tp==='movie'
    ? `https://player.videasy.net/movie/${id}?color=FF006E`
    : `https://player.videasy.net/tv/${id}/${s}/${e}?color=FF006E&episodeSelector=true`,
  // 4. Mapple
  (tp,id,s,e)=>tp==='movie'
    ? `https://mapple.uk/watch/movie/${id}`
    : `https://mapple.uk/watch/tv/${id}-${s}-${e}`,
];

const SUPABASE_URL = 'https://rtyfpyvqgvqozprquusx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_pZWtF-u8B8bXIR-AZ86onQ_wwoikRzF';
let dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ========== STATE ==========
let currentUser = null, currentFavs = [], currentHistory = [];
let heroItems = [], heroIdx = 0, heroTimer;
let curItem = null, curType = 'movie', curSeason = 1, curEp = 1, curSrc = 0;
let pMov = 1, pTV = 1, curTab = 'all', allGenres = [];
let originalMainHTML = '';
let searchAbortController = null, searchTimeout = null;
let friends = [], friendRequests = [], allNotifications = [], currentDMUser = null;
let isAdmin = false;
let wpPeer = null, wpConnections = [], wpRoomCode = null, wpIsHost = false, pendingRoomCode = null;
let syncTimer = null, lastSyncTime = 0, lastSyncPlaying = false, isBuffering = false;

// قائمة الصور الرمزية (Avatars)
const PRESET_AVATARS = ['👨','👩','👦','👧','🦸‍♂️','🦸‍♀️','🥷','🧛‍♂️','🧚‍♀️','🕵️‍♂️','🧑‍🚀','🦁','🐼','🦊','🦉'];

const $ = id => document.getElementById(id) || document.createElement('div');

// ========== 🔥 إزالة sandbox نهائياً (مثل Novacast) ==========
function removeSandboxFromVideoIframes() {
    const videoIframes = document.querySelectorAll('#pframe, #wpPlayerFrame, #trailerFrame');
    videoIframes.forEach(iframe => {
        if (iframe.hasAttribute('sandbox')) {
            iframe.removeAttribute('sandbox');
            console.log('✅ تم إزالة sandbox من:', iframe.id);
        }
    });
}

// مراقبة إضافة iframes جديدة
const sandboxObserver = new MutationObserver(() => removeSandboxFromVideoIframes());
sandboxObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['sandbox'] });

// ========== UI HELPERS (MODALS & TOASTS) ==========
function toggleModal(modalId, show) {
    const modal = $(modalId);
    if (modal) {
        if (show) {
            modal.classList.add('active');
            if (['inviteFriendsModal', 'recommendModal', 'dmModal', 'notificationsModal'].includes(modalId)) modal.style.display = 'flex';
        } else {
            modal.classList.remove('active');
            if (['inviteFriendsModal', 'recommendModal', 'dmModal', 'notificationsModal'].includes(modalId)) modal.style.display = 'none';
        }
    }
}
function showLogin() { toggleModal('loginModal', true); }
function closeLoginModal() { toggleModal('loginModal', false); }
function closeSettings() { toggleModal('settingsModal', false); }
function closeFriends() { toggleModal('friendsModal', false); }
function closeAdmin() { toggleModal('adminModal', false); }
function closeInviteModal() { toggleModal('inviteFriendsModal', false); }
function closeRecommendModal() { toggleModal('recommendModal', false); }
function closeDMModal() { toggleModal('dmModal', false); currentDMUser = null; }
function closeNotifications() { toggleModal('notificationsModal', false); }

function showToast(m) { 
    let t = $('toast'); t.textContent = m; t.classList.add('on'); 
    setTimeout(() => t.classList.remove('on'), 2500); 
}

function showNotification(notif) {
    if ($('ppage').classList.contains('open') || $('watchPartyModal').classList.contains('active')) {
        loadNotifications();
        return;
    }
    const toast = document.createElement('div');
    toast.className = 'fancy-toast notif-toast';
    let icon = '🔔', text = notif.message || 'إشعار جديد', btnText = '', btnAction = '';
    if (notif.type === 'friend_request') {
        icon = '📩'; text = 'طلب صداقة جديد'; btnText = 'عرض الطلبات'; btnAction = `loadFriendRequests(); this.parentElement.remove(); openFriends();`;
    } else if (notif.type === 'room_invite') {
        icon = '🎬'; text = `${notif.sender?.display_name || 'صديق'} يدعوك للمشاهدة!`; btnText = 'قبول وانضمام'; btnAction = `joinWatchParty('${notif.data?.roomCode}'); this.parentElement.remove();`;
    } else if (notif.type === 'recommendation') {
        icon = '⭐'; text = `${notif.sender?.display_name || 'صديق'} يرشح لك هذا العمل`; btnText = 'عرض التفاصيل'; btnAction = `openRecommendedMovie('${notif.data?.movie_id}', '${notif.data?.media_type}'); this.parentElement.remove();`;
    } else if (notif.type === 'direct_message') {
        icon = '💬'; text = `رسالة جديدة من ${notif.sender?.display_name || 'صديق'}`; btnText = 'رد على الرسالة'; btnAction = `openDM('${notif.sender_id}', '${notif.sender?.display_name || 'صديق'}'); this.parentElement.remove();`;
    } else return;
    toast.innerHTML = `<div style="display:flex;align-items:center;gap:12px;width:100%;"><div style="font-size:24px">${icon}</div> <div style="font-size:14px;font-weight:700;">${text}</div></div> <button onclick="${btnAction}" class="fancy-toast-btn">${btnText}</button>`;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 8000);
    loadNotifications();
}
async function openRecommendedMovie(id, type) {
    try { const item = await fetchDetail(type, id); if (item) openDetail(item); } catch (e) { showToast('عذراً، المحتوى غير متوفر'); }
}

// ========== API GATEWAYS & AUTH (بدون تغيير) ==========
async function gatewayRequest(path, method, body, token) { 
    const response = await fetch(API_GATEWAY, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path,method,body,token}) }); 
    const data = await response.json(); 
    if (!response.ok) throw new Error(data.error || 'فشل الطلب'); 
    return data; 
}
async function authGateway(action, payload = {}) { 
    const response = await fetch(AUTH_GATEWAY, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,...payload}) }); 
    const result = await response.json(); 
    if (!response.ok) throw new Error(result.error || 'فشل الطلب'); 
    return result; 
}

$('tabLoginModal').addEventListener('click', ()=>{ $('tabLoginModal').classList.add('active'); $('tabRegisterModal').classList.remove('active'); $('loginFormModal').style.display='block'; $('registerFormModal').style.display='none'; });
$('tabRegisterModal').addEventListener('click', ()=>{ $('tabRegisterModal').classList.add('active'); $('tabLoginModal').classList.remove('active'); $('registerFormModal').style.display='block'; $('loginFormModal').style.display='none'; });

$('btnLogin').addEventListener('click', async ()=>{ 
    const email = $('loginEmail').value.trim(), pass = $('loginPass').value.trim(), err = $('loginError'), btn = $('btnLogin');
    err.classList.remove('show'); 
    if(!email||!pass) { err.textContent='يرجى إدخال البريد وكلمة المرور'; err.classList.add('show'); return; } 
    const originalText = btn.textContent;
    btn.innerHTML = '<span class="spin2" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-left:6px;"></span> جاري الدخول...';
    btn.disabled = true;
    try { 
        const { data, error } = await authGateway('login', { email, password: pass }); 
        if(error) { 
            err.textContent=error.message; err.classList.add('show'); 
            btn.innerHTML = originalText; btn.disabled = false;
        } 
        else { 
            currentUser = data.user; localStorage.setItem('shush_session', JSON.stringify(data.session)); 
            closeLoginModal(); updateUIAfterLogin(); 
            const displayName = currentUser.user_metadata?.display_name || currentUser.email.split('@')[0];
            $('greetingText').textContent = '👋 أهلاً بك ' + displayName + '!'; 
            $('greetingSplash').classList.add('active'); 
            setTimeout(() => $('greetingSplash').classList.remove('active'), 2000);
            btn.innerHTML = originalText; btn.disabled = false;
            loadUserData().then(() => { if (pendingRoomCode) { joinWatchParty(pendingRoomCode); pendingRoomCode = null; } });
        } 
    } catch(e) { 
        err.textContent = e.message; err.classList.add('show'); 
        btn.innerHTML = originalText; btn.disabled = false;
    } 
});

$('btnRegister').addEventListener('click', async ()=>{ 
    const email = $('regEmail').value.trim(), pass = $('regPass').value.trim(), confirm = $('regPassConfirm').value.trim(), name = $('regName').value.trim(), err = $('regError'); 
    err.classList.remove('show'); 
    if(!email||!pass||!confirm) { err.textContent='يرجى ملء جميع الحقول'; err.classList.add('show'); return; } 
    if(pass!==confirm) { err.textContent='كلمتا المرور غير متطابقتين'; err.classList.add('show'); return; } 
    try { 
        const { error } = await authGateway('register', { email, password: pass, displayName: name }); 
        if(error) { err.textContent=error.message; err.classList.add('show'); } 
        else { alert('تم إنشاء الحساب بنجاح! سجل دخول الآن.'); $('tabLoginModal').click(); $('loginEmail').value = email; } 
    } catch(e) { err.textContent = e.message; err.classList.add('show'); } 
});

async function logout() { 
    closeWatchParty(); await authGateway('logout'); localStorage.removeItem('shush_session'); 
    currentUser=null; currentFavs=[]; currentHistory=[]; dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    $('userBtn').style.display='flex'; $('userInfo').style.display='none'; $('notifBtn').style.display='none';
    showAllSections(); 
    $('greetingText').textContent = '👋 إلى اللقاء!'; 
    $('greetingSplash').classList.add('active'); 
    setTimeout(() => $('greetingSplash').classList.remove('active'), 2000);
    if (notificationChannel) notificationChannel.unsubscribe();
}
function updateUIAfterLogin() { 
    $('userBtn').style.display='none'; $('userInfo').style.display='flex'; $('notifBtn').style.display='flex';
    $('userEmoji').textContent = currentUser.user_metadata?.avatar||'😊'; 
    $('userName').textContent = currentUser.user_metadata?.display_name||currentUser.email; 
}
function toggleUserDropdown() { $('userDropdown').classList.toggle('show'); }
document.addEventListener('click', (e) => { if (!e.target.closest('#userInfo')) { $('userDropdown').classList.remove('show'); } });

// ========== DATA LOADING & REALTIME (بدون تغيير) ==========
let notificationChannel = null;
async function loadUserData() { 
    if(!currentUser) return; 
    try { 
        const session = JSON.parse(localStorage.getItem('shush_session')); if (!session) return; 
        const token = session.access_token; 
        dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
        dbClient.realtime.setAuth(token);
        const { data: prof } = await dbClient.from('profiles').select('is_banned').eq('id', currentUser.id).single();
        if (prof?.is_banned) { alert('حسابك محظور من قبل الإدارة.'); logout(); return; }
        currentFavs = (await gatewayRequest('favorites', 'GET', { columns: '*' }, token)) || []; 
        currentHistory = (await gatewayRequest('history', 'GET', { columns: '*' }, token)) || []; 
        await loadFriends(); await loadFriendRequests(); await loadNotifications(); await checkAdmin();
        if (curTab === 'fav') renderFavorites(); 
        if (curTab === 'hist') renderHistory(); 
        subscribeToRealtime();
    } catch(e) { console.error(e); } 
}
function subscribeToRealtime() {
    if (!currentUser) return;
    if (notificationChannel) dbClient.removeChannel(notificationChannel);
    notificationChannel = dbClient.channel('custom-user-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, async payload => {
            const newNotif = payload.new;
            const { data: senderData } = await dbClient.from('profiles').select('display_name, avatar').eq('id', newNotif.sender_id).single();
            newNotif.sender = senderData;
            showNotification(newNotif);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `receiver_id=eq.${currentUser.id}` }, async payload => {
            if (currentDMUser === payload.new.sender_id) { loadDMs(currentDMUser); } 
            else { 
                const { data: senderData } = await dbClient.from('profiles').select('display_name, avatar').eq('id', payload.new.sender_id).single();
                showNotification({ type: 'direct_message', sender_id: payload.new.sender_id, sender: senderData }); 
            }
        })
        .subscribe((status, err) => { console.log("📡 حالة التحديث اللحظي:", status); if(err) console.error(err); });
}

// ========== باقي الدوال (الإشعارات، الرسائل، الأصدقاء، الإعدادات، المشرف) ==========
// تم الاحتفاظ بها كما هي من كودك الأصلي - لم يتم تغييرها

// لتوفير المساحة، سيتم تضمينها بشكل مختصر، لكن في ملفك الأصلي ستبقى كما هي
async function loadNotifications() { /* ... */ }
function openNotifications() { /* ... */ }
async function markNotifRead(id) { /* ... */ }
async function deleteNotif(id) { /* ... */ }
async function openDM(friendId, friendName) { /* ... */ }
async function loadDMs(friendId) { /* ... */ }
async function sendDMsg() { /* ... */ }
function openRecommendModal() { /* ... */ }
async function sendRecommendation(friendId) { /* ... */ }
function openFriends() { /* ... */ }
async function searchFriend() { /* ... */ }
async function sendFriendRequest(receiverId) { /* ... */ }
async function loadFriendRequests() { /* ... */ }
async function acceptFriendRequest(requestId, senderId) { /* ... */ }
async function rejectFriendRequest(requestId) { /* ... */ }
async function loadFriends() { /* ... */ }
async function removeFriend(friendId) { /* ... */ }
function openSettings() { /* ... */ }
function selectAvatar(el, avatar) { /* ... */ }
async function saveSettings() { /* ... */ }
async function checkAdmin() { /* ... */ }
function openAdmin() { /* ... */ }
async function switchAdminTab(tab, btn) { /* ... */ }
async function loadAdminStats() { /* ... */ }
async function loadAdminUsers() { /* ... */ }
async function toggleBan(uid, isBanned) { /* ... */ }
async function changeRole(uid, currentRole) { /* ... */ }
async function deleteUser(userId) { /* ... */ }
async function adminResetPassword(uid) { /* ... */ }
async function loadAdminChannels() { /* ... */ }
async function toggleChannelActive(id, active) { /* ... */ }
async function searchAdminChannel() { /* ... */ }

// ========== MEDIA & TMDB (Core Features) ==========
function hideAllSections(){ $('sec-all').style.display='none'; $('sec-fav').style.display='none'; $('sec-hist').style.display='none'; $('search-results').style.display='none'; }
function showAllSections(){ $('sec-all').style.display='block'; $('sec-fav').style.display='none'; $('sec-hist').style.display='none'; $('search-results').style.display='none'; }
async function api(p){ let s=p.includes('?')?'&':'?'; return (await fetch(`${T}${p}${s}api_key=${TMDB_KEY}&language=ar`)).json(); }

async function loadHero(){ 
    try{ let r = await api('/trending/all/week'); let items = (r.results||[]).filter(x=>x.poster_path&&x.backdrop_path); heroItems = items.slice(0,6); const slider = $('heroSlider'); document.querySelectorAll('.hero-slide').forEach(s=>s.remove()); heroItems.forEach((item,i)=>{ let slide = document.createElement('div'); slide.className = 'hero-slide'+(i===0?' active':''); slide.style.backgroundImage = `url(${IMG}original${item.backdrop_path})`; slider.insertBefore(slide, slider.firstChild); }); $('heroDots').innerHTML = heroItems.map((_,i)=>`<button class="hdot${i===0?' active':''}" data-idx="${i}"></button>`).join(''); document.querySelectorAll('.hdot').forEach(b=>b.addEventListener('click',()=>goToHero(parseInt(b.dataset.idx)))); updateHeroInfo(0); startHeroTimer(); appendCards('g-trend', r.results||[]); }catch(e){} 
}
function updateHeroInfo(idx){ let item=heroItems[idx]; if(!item)return; heroIdx=idx; let isM=item.media_type==='movie'||item.title; $('htitle').textContent=item.title||item.name; $('hdesc').textContent=item.overview||''; $('hmeta').innerHTML=`<span>⭐ ${(item.vote_average||0).toFixed(1)}</span><span>${(item.release_date||item.first_air_date||'').slice(0,4)}</span><span style="background:var(--bg4);padding:2px 6px;border-radius:6px">${isM?'فيلم':'مسلسل'}</span>`; }
function goToHero(idx){ clearInterval(heroTimer); document.querySelectorAll('.hero-slide').forEach((s,i)=>s.classList.toggle('active',i===idx)); document.querySelectorAll('.hdot').forEach((d,i)=>d.classList.toggle('active',i===idx)); updateHeroInfo(idx); startHeroTimer(); }
function startHeroTimer(){ clearInterval(heroTimer); heroTimer=setInterval(()=>{ goToHero((heroIdx+1)%heroItems.length); },5000); }
function heroWatch(){ if(heroItems[heroIdx]) openDetail(heroItems[heroIdx]); }

async function initGenres(){ try{ let r=await api('/genre/movie/list'); allGenres=r.genres.slice(0,14); $('genreBar').innerHTML='<button class="gbtn on" onclick="clearGenre(this)">🔥 الكل</button>'+allGenres.map(g=>`<button class="gbtn" onclick="pickGenre(${g.id},'${g.name}',this)">${g.name}</button>`).join(''); }catch(e){} }
function clearGenre(el){ document.querySelectorAll('.gbtn').forEach(b=>b.classList.remove('on')); el.classList.add('on'); showAllSections(); document.querySelector('#sec-genre-dynamic')?.remove(); }
async function pickGenre(id,name,el){ document.querySelectorAll('.gbtn').forEach(b=>b.classList.remove('on')); el.classList.add('on'); hideAllSections(); document.querySelector('#sec-genre-dynamic')?.remove(); const mt=curTab==='tv'?'tv':'movie'; let r=await api(`/discover/${mt}?with_genres=${id}&page=1`); let items=(r.results||[]).slice(0,18); let sec=document.createElement('div'); sec.className='sec'; sec.id='sec-genre-dynamic'; sec.innerHTML=`<div class="sec-h"><div class="sec-t"><div class="bar"></div>🎬 ${name}</div></div><div class="grid"></div>`; items.forEach(i=>sec.querySelector('.grid').appendChild(mkCard(i))); $('main').prepend(sec); }

const fetchMov=p=>api(`/movie/popular?page=${p}`).then(r=>r.results||[]); const fetchTV=p=>api(`/tv/popular?page=${p}`).then(r=>r.results||[]);
const fetchSearch=(q,p,signal)=>fetch(`${T}/search/multi?query=${encodeURIComponent(q)}&page=${p}&api_key=${TMDB_KEY}&language=ar`,{signal}).then(r=>r.json()).then(r=>r.results||[]);
const fetchDetail = async (t, id) => { const data = await api(`/${t}/${id}?append_to_response=credits,seasons`); try { const videoData = await fetch(`${T}/${t}/${id}?append_to_response=videos&api_key=${TMDB_KEY}`).then(r => r.json()); data.videos = videoData.videos; } catch(e) {} return data; };

function mkCard(item){ 
    let isM;
    if (item.media_type === 'tv') isM = false;
    else if (item.media_type === 'movie') isM = true;
    else isM = (item.title && !item.name);
    let title = item.title || item.name || '', year = (item.release_date || item.first_air_date || '').slice(0,4), rat = (item.vote_average || 0).toFixed(1), poster = item.poster_path ? `${IMG}w300${item.poster_path}` : ''; 
    let fid = String(item.id), favActive = currentUser && currentFavs.some(f => f.movie_id === fid); 
    let d = document.createElement('div'); d.className = 'card'; 
    d.innerHTML = `<div class="cthumb">${poster ? `<img src="${poster}" loading="lazy">` : ''}<div class="cov"><div class="cplay"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div><button class="cfavorite${favActive ? ' active' : ''}" onclick="event.stopPropagation();toggleFav({id:'${fid}',title:'${title.replace(/'/g,"\\'")}',poster:'${poster}',type:'${isM ? 'movie' : 'tv'}'}, this)">${favActive ? '❤️' : '🤍'}</button><div class="cbadge ${isM ? 'bm' : 'bt'}">${isM ? 'فيلم' : 'مسلسل'}</div>${rat > 0 ? `<div class="crat">⭐${rat}</div>` : ''}</div><div class="cinfo"><div class="cname">${title}</div><div class="cyear">${year}</div></div>`; 
    d.addEventListener('click', () => openDetail(item)); return d; 
}

function appendCards(gid,items){ let g=$(gid); if(!g || !items || !Array.isArray(items))return; items.forEach(item=>{ if(item.media_type!=='person'&&(item.poster_path||item.backdrop_path)) g.appendChild(mkCard(item)); }); }

async function init(){ 
    if (!document.getElementById('g-mov')) return;
    initGenres(); 
    await loadHero(); 
    try{ let m=await fetchMov(1); appendCards('g-mov',m); $('b-mov').style.display='block'; }catch(e){} 
    try{ let t=await fetchTV(1); appendCards('g-tv',t); $('b-tv').style.display='block'; }catch(e){} 
}

function switchTab(tab,el){ 
    if((tab==='fav'||tab==='hist')&&!currentUser){ showLogin(); return; } 
    curTab=tab; document.querySelectorAll('.ntab').forEach(t=>t.classList.remove('on')); if(el) el.classList.add('on'); 
    hideAllSections(); document.querySelector('#sec-genre-dynamic')?.remove(); document.querySelectorAll('.gbtn').forEach(b=>b.classList.remove('on')); const a=document.querySelector('.gbtn'); if(a)a.classList.add('on');
    if(tab==='fav'){ $('sec-fav').style.display='block'; renderFavorites(); } 
    else if(tab==='hist'){ $('sec-hist').style.display='block'; renderHistory(); } 
    else { 
        $('sec-all').style.display='block'; let trend=$('g-trend')?.parentElement, mov=$('g-mov')?.parentElement, tv=$('g-tv')?.parentElement; 
        if(trend) trend.style.display='block'; if(mov) mov.style.display='block'; if(tv) tv.style.display='block'; 
        if(tab==='movie'){ if(trend) trend.style.display='none'; if(tv) tv.style.display='none'; } else if(tab==='tv'){ if(trend) trend.style.display='none'; if(mov) mov.style.display='none'; } 
    } 
}

function renderFavorites() { let g = $('g-fav'); g.innerHTML = ''; if (!currentFavs.length) { g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--t2)">فارغ</div>'; return; } currentFavs.forEach(f => g.appendChild(mkCard({id: f.movie_id, title: f.title, poster_path: f.poster ? f.poster.replace(IMG + 'w300', '') : '', media_type: f.type || 'movie', vote_average: 0}))); }
function renderHistory() { let g = $('g-hist'); g.innerHTML = ''; if (!currentHistory.length) { g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--t2)">فارغ</div>'; return; } currentHistory.forEach(h => g.appendChild(mkCard({id: h.movie_id, title: h.title, poster_path: h.poster ? h.poster.replace(IMG + 'w300', '') : '', media_type: h.type || 'movie', vote_average: 0}))); }

async function toggleFav(item, btn) { 
    if(!currentUser) { showLogin(); return; } 
    try { 
        const token = JSON.parse(localStorage.getItem('shush_session')).access_token; const exists = currentFavs.find(f=>f.movie_id===item.id); 
        if(exists) { await gatewayRequest('favorites', 'DELETE', { column: 'id', value: exists.id }, token); currentFavs = currentFavs.filter(f=>f.id!==exists.id); if(btn) { btn.classList.remove('active'); btn.textContent='🤍'; } showToast('تم الإزالة'); } 
        else { const newFav = await gatewayRequest('favorites', 'POST', { user_id: currentUser.id, movie_id: item.id, title: item.title, poster: item.poster||'', type: item.type }, token); if(newFav && newFav.length) { currentFavs.push(newFav[0]); if(btn) { btn.classList.add('active'); btn.textContent='❤️'; } showToast('❤️ أضيف لقائمتي'); } } 
        if(curTab==='fav') renderFavorites(); 
    } catch(e) {} 
}
async function addToHistory(item) { 
    if(!currentUser) return; 
    try { const token = JSON.parse(localStorage.getItem('shush_session')).access_token; const existing = currentHistory.find(h => h.movie_id === item.id); if (existing) await gatewayRequest('history', 'DELETE', { column: 'id', value: existing.id }, token); await gatewayRequest('history', 'POST', { user_id: currentUser.id, movie_id: item.id, title: item.title, poster: item.poster||'', type: item.type }, token); const hist = await gatewayRequest('history', 'GET', { columns: '*' }, token); currentHistory = hist || []; if(curTab==='hist') renderHistory(); } catch(e) {} 
}

// ========== DETAILS & VIDEO (المعدل مثل Novacast) ==========
let trailerKey = null;
async function openDetail(item){
    curItem=item; curSeason=1; curEp=1; curSrc=0; curType = item.media_type || (item.title && !item.name ? 'movie' : 'tv');
    let title=item.title||item.name||'', year=(item.release_date||item.first_air_date||'').slice(0,4), rat=(item.vote_average||0).toFixed(1);
    $('d-back').src=''; $('d-poster').src=''; $('dep').style.display='none'; $('d-seasons').innerHTML=''; $('d-eps').innerHTML=''; if($('d-meta'))$('d-meta').innerHTML=''; if($('d-cast-wrap'))$('d-cast-wrap').style.display='none'; if($('d-cast'))$('d-cast').innerHTML='';
    $('dov').classList.add('open'); document.body.style.overflow='hidden';
    $('d-title').textContent=title; $('d-ov').textContent=item.overview||'جاري التحميل...';
    if(item.backdrop_path)$('d-back').src=`${IMG}w1280${item.backdrop_path}`; if(item.poster_path)$('d-poster').src=`${IMG}w500${item.poster_path}`;
    $('d-tags').innerHTML=`<span class="dtag gold">⭐ ${rat}</span><span class="dtag">${year}</span><span class="dtag">${curType==='movie'?'🎬 فيلم':'📺 مسلسل'}</span>`;
    addToHistory({id:String(item.id),title,poster:item.poster_path?`${IMG}w300${item.poster_path}`:'',type:curType});
    try{
        let det = await fetchDetail(curType, item.id);
        if (!det || (!det.overview && !det.runtime && !det.number_of_seasons)) { const altType = curType === 'movie' ? 'tv' : 'movie'; det = await fetchDetail(altType, item.id); if (det && (det.overview || det.runtime || det.number_of_seasons)) curType = altType; }
        curItem={...item,...det};
        if(det.backdrop_path) $('d-back').src = `${IMG}w1280${det.backdrop_path}`; if(det.poster_path) $('d-poster').src = `${IMG}w500${det.poster_path}`;
        $('d-ov').textContent = det.overview || item.overview || 'لا يوجد وصف';
        let genres=(det.genres||[]).map(g=>`<span class="dtag">${g.name}</span>`).join(''); $('d-tags').innerHTML+=genres;
        let trailer = det.videos?.results?.find(v => v.type === "Trailer" && v.site === "YouTube"); if (trailer) { trailerKey = trailer.key; $('trailerWatchBtn').classList.add('show'); } else { trailerKey = null; $('trailerWatchBtn').classList.remove('show'); }
        let metaHtml = ''; const addRow = (icon, label, value) => { if(value) metaHtml += `<div class="dmetarow">${icon}<span>${label}</span><span>${value}</span></div>`; };
        addRow('⏱️', 'المدة', det.runtime ? `${Math.floor(det.runtime/60)}س ${det.runtime%60}د` : null); addRow('🌍', 'البلد', (det.production_countries || []).map(c=>c.name).join(', ') || null);
        if(curType==='tv') { addRow('📺', 'الحالة', det.status); addRow('📑', 'المواسم', det.number_of_seasons); addRow('🎬', 'الحلقات', det.number_of_episodes); }
        if($('d-meta'))$('d-meta').innerHTML = metaHtml || '';
        if(det.credits&&det.credits.cast){ let cast=det.credits.cast.slice(0,8); $('d-cast').innerHTML=cast.map(c=>`<div class="dcast-item">${c.profile_path?`<img src="${IMG}w185${c.profile_path}">`:`<div style="width:48px;height:48px;border-radius:50%;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:16px">👤</div>`}<span>${c.name}</span></div>`).join(''); $('d-cast-wrap').style.display='block'; }
        if(curType==='tv'&&det.seasons){ let seasons=det.seasons.filter(s=>s.season_number>0); if(seasons.length){ $('dep').style.display='block'; $('d-seasons').innerHTML=seasons.map((s,i)=>`<button class="sbtn ${i===0?'on':''}" onclick="selSeason(${s.season_number},${s.episode_count},this)">${s.name||'الموسم '+s.season_number}</button>`).join(''); renderEps(1,seasons[0].episode_count); } }
    }catch(e){}
}

function selSeason(n,ec,btn){ curSeason=n; curEp=1; document.querySelectorAll('#d-seasons .sbtn').forEach(b=>b.classList.remove('on')); btn.classList.add('on'); renderEps(n,ec); }
function renderEps(season,total){ let max=Math.min(total,100); $('d-eps').innerHTML=Array.from({length:max},(_,i)=>`<button class="epbtn ${i===0?'on':''}" onclick="selEp(${i+1},this)">ح${i+1}</button>`).join(''); }
function selEp(n,btn){ curEp=n; document.querySelectorAll('#d-eps .epbtn').forEach(b=>b.classList.remove('on')); btn.classList.add('on'); }
function closeDetail(){ $('dov').classList.remove('open'); document.body.style.overflow=''; }
function playTrailer() { 
    if (trailerKey) { 
        $('trailerFrame').src = `https://www.youtube.com/embed/${trailerKey}?autoplay=1`; 
        // إزالة sandbox مثل Novacast
        $('trailerFrame').onload = () => {
            if ($('trailerFrame').hasAttribute('sandbox')) {
                $('trailerFrame').removeAttribute('sandbox');
            }
        };
        toggleModal('trailerModal', true); 
    } 
}
function closeTrailer() { $('trailerFrame').src = ''; toggleModal('trailerModal', false); }

// 🔥 دالة تشغيل الفيديو (مثل Novacast - بدون شاشة "انقر هنا")
async function openPlayerFromDetail(){ 
    if (!currentUser) { showLogin(); return; } closeDetail(); 
    let title=curItem.title||curItem.name||''; $('ptitle').textContent=curType==='tv'?`${title} — م${curSeason} ح${curEp}`:title; 
    $('ppage').classList.add('open'); document.body.style.overflow='hidden'; document.querySelectorAll('.psrc').forEach((b,i)=>b.classList.toggle('on',i===0)); curSrc=0; 
    if(curType==='tv'&&curItem.seasons&&curItem.seasons.length){ $('pep').style.display='block'; buildPepRow(); } else { $('pep').style.display='none'; } 
    // تم إزالة mainClickPrompt نهائياً
    const progress = await getProgress(String(curItem.id), curType, curSeason, curEp); 
    loadFrame(progress ? Math.floor(progress.progress) : 0); 
}

// دالة buildPepRow تبقى كما هي
function buildPepRow(){ let row=$('pep-row'); row.innerHTML=''; if(!curItem.seasons)return; let seasons=curItem.seasons.filter(s=>s.season_number>0); seasons.forEach(s=>{ let sbtn=document.createElement('button'); sbtn.className='pep-sbtn'+(s.season_number===curSeason?' on':''); sbtn.textContent=s.name||'م '+s.season_number; sbtn.onclick=()=>pepSeason(s.season_number,s.episode_count,sbtn); row.appendChild(sbtn); if(s.season_number===curSeason){ let max=Math.min(s.episode_count,100); for(let i=1;i<=max;i++){ let ebtn=document.createElement('button'); ebtn.className='pep-epbtn'+(i===curEp?' on':''); ebtn.textContent='ح'+i; ebtn.onclick=()=>pepEp(i,ebtn); row.appendChild(ebtn); } } }); }
function pepSeason(n,ec,btn){ curSeason=n; curEp=1; buildPepRow(); loadFrame(0); $('ptitle').textContent=`${curItem.title||curItem.name} — م${curSeason} ح${curEp}`; }
function pepEp(n,btn){ curEp=n; document.querySelectorAll('#pep-row .pep-epbtn').forEach(b=>b.classList.remove('on')); if(btn)btn.classList.add('on'); loadFrame(0); $('ptitle').textContent=`${curItem.title||curItem.name} — م${curSeason} ح${curEp}`; }

// 🔥 دالة loadFrame (مثل Novacast - بدون referrerpolicy، مع إزالة sandbox فقط)
function loadFrame(startTime = 0){ 
    $('pload').style.display='flex'; 
    $('pframe').src=''; 
    setTimeout(()=>{ 
        let url = SRCS[curSrc](curType,curItem.id,curSeason,curEp); 
        if (startTime > 0 && curSrc === 0) url += (url.includes('?')?'&':'?') + `startTime=${startTime}`; 
        $('pframe').src = url; 
        $('pframe').onload = () => {
            // نزيل sandbox فقط إذا وجدت (لن تظهر لأننا لا نضيفها)
            if ($('pframe').hasAttribute('sandbox')) {
                $('pframe').removeAttribute('sandbox');
            }
            $('pload').style.display='none';
        };
        setTimeout(()=>$('pload').style.display='none',6000); 
    },150); 
}

function switchSrc(idx,btn){ 
    curSrc=idx; 
    document.querySelectorAll('.psrc').forEach(b=>b.classList.remove('on')); 
    btn.classList.add('on'); 
    loadFrame(0);
}

function closePlayer(){ $('ppage').classList.remove('open'); $('pframe').src=''; document.body.style.overflow=''; showAllSections(); }

// ========== SEARCH (لم تتغير) ==========
function performSearch(){ 
    let q=$('sinput').value.trim(); if(searchAbortController)searchAbortController.abort(); 
    if(q.length<2){ if(originalMainHTML)$('main').innerHTML=originalMainHTML; showAllSections(); return; } 
    searchAbortController=new AbortController(); let signal=searchAbortController.signal; 
    hideAllSections(); $('search-results').style.display='block'; $('g-search').innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--t2)">جاري البحث...</div>'; 
    fetchSearch(q,1,signal).then(res=>{ if(signal.aborted)return; $('g-search').innerHTML=''; if(!res.length) $('g-search').innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--t2)">لا توجد نتائج</div>'; else res.forEach(item=>{ if(item.media_type!=='person'&&(item.poster_path||item.backdrop_path)) $('g-search').appendChild(mkCard(item)); }); }).catch(()=>{}); 
}
$('sinput').addEventListener('input', () => { clearTimeout(searchTimeout); searchTimeout = setTimeout(performSearch, 600); });
$('searchIcon').addEventListener('click', performSearch);

// ========== WATCH PARTY (المعدل مثل Novacast) ==========
function showJoinSplash(text) { $('joinSplashText').textContent = text; $('joinSplashError').style.display = 'none'; $('joinSplashRetry').style.display = 'none'; $('joinSplash').classList.add('active'); }
function showJoinError(msg) { $('joinSplashText').textContent = ''; $('joinSplashError').textContent = msg; $('joinSplashError').style.display = 'block'; $('joinSplashRetry').style.display = 'block'; }
function hideJoinSplash() { $('joinSplash').classList.remove('active'); }
function retryJoinRoom() { const code = pendingRoomCode || new URLSearchParams(window.location.search).get('room'); if (code) { showJoinSplash('🎉 جاري الانضمام...'); joinWatchParty(code); } }
function copyInviteLink() { navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?room=${wpRoomCode}`).then(() => showToast('📋 تم النسخ')); }
function appendChatMessage(name, msg, isMe) { const chat = $('wpChat'); const div = document.createElement('div'); div.className = 'wp-chat-msg'; div.innerHTML = `<div class="avatar">${isMe ? '😊' : '👤'}</div><div class="content"><div class="name">${name}</div>${msg}</div>`; chat.appendChild(div); chat.scrollTop = chat.scrollHeight; }
function sendChatMessage() { const input = $('wpMessageInput'); const msg = input.value.trim(); if (!msg) return; const displayName = currentUser?.user_metadata?.display_name || 'مجهول'; appendChatMessage(displayName, msg, true); broadcastToPeers({ type: 'chat', displayName, message: msg }); input.value = ''; }
function applySyncToPlayer(data) { const frame = $('wpPlayerFrame'); if (!frame || isBuffering) return; const drift = Math.abs(data.time - lastSyncTime); if (drift < 5) return; if (data.command === 'play') { frame.contentWindow.postMessage({ command: 'seek', time: data.time || 0 }, '*'); setTimeout(() => { frame.contentWindow.postMessage({ command: 'play' }, '*'); }, 300); } else if (data.command === 'pause') { frame.contentWindow.postMessage({ command: 'seek', time: data.time || 0 }, '*'); setTimeout(() => frame.contentWindow.postMessage({ command: 'pause' }, '*'), 300); } }
function broadcastToPeers(data) { wpConnections.forEach(conn => { if (conn.open) conn.send(data); }); }
function updateUsersList() {
    const usersList = $('wpUsersList'); usersList.querySelectorAll('.wp-user-item').forEach(el => el.remove());
    const myName = currentUser?.user_metadata?.display_name || 'أنا'; const myDiv = document.createElement('div'); myDiv.className = 'wp-user-item'; myDiv.innerHTML = `<div class="user-name"><span class="user-dot"></span><span>${myName}</span>${wpIsHost ? '<span class="host-badge">المضيف</span>' : ''}</div>`; usersList.appendChild(myDiv);
    const addedNames = new Set([myName]);
    wpConnections.forEach(conn => { const isPeerHost = conn.peer && conn.peer.endsWith('-host'); let name = conn.metadata?.displayName || (isPeerHost ? 'المضيف' : 'ضيف'); if (addedNames.has(name)) return; addedNames.add(name); const userDiv = document.createElement('div'); userDiv.className = 'wp-user-item'; let actionsHtml = wpIsHost && !isPeerHost ? `<div class="wp-user-actions"><button class="kick-btn" onclick="disconnectPeer('${conn.peer}')" title="طرد">🗑️</button></div>` : ''; userDiv.innerHTML = `<div class="user-name"><span class="user-dot"></span><span>${name}</span>${isPeerHost ? '<span class="host-badge">المضيف</span>' : ''}</div>${actionsHtml}`; usersList.appendChild(userDiv); });
}
window.disconnectPeer = function(peerId) { const conn = wpConnections.find(c => c.peer === peerId); if (conn) { conn.close(); wpConnections = wpConnections.filter(c => c.peer !== peerId); updateUsersList(); } };
function setupConnection(conn) { 
    conn.on('open', () => { 
        if (wpIsHost) { 
            conn.send({ type: 'host_info', displayName: currentUser?.user_metadata?.display_name || 'المضيف' }); 
            const frame = $('wpPlayerFrame'); 
            if (frame) frame.contentWindow.postMessage({ command: 'getStatus' }, '*'); 
        } 
        wpConnections.push(conn); 
        updateUsersList(); 
        conn.on('data', (data) => { 
            if (data.type === 'leave') { conn.close(); return; } 
            if (data.type === 'host_info') { conn.metadata = conn.metadata || {}; conn.metadata.displayName = data.displayName; updateUsersList(); return; } 
            if (data.type === 'chat') { appendChatMessage(data.displayName, data.message, false); } 
            else if (data.type === 'sync') { if (!wpIsHost) applySyncToPlayer(data); } 
            else if (data.type === 'kick') { if (!wpIsHost) { showToast('تم إنهاء الغرفة'); closeWatchParty(); } } 
            else if (data.type === 'episode_change') { const frame = $('wpPlayerFrame'); if (frame && data.url) { frame.src = data.url; showToast(`📺 انتقل المضيف إلى الحلقة ${data.episode}`); } } 
        }); 
        conn.on('close', () => { wpConnections = wpConnections.filter(c => c !== conn); updateUsersList(); }); 
    }); 
}
function initPeer(asHost) {
    const peerId = `shush-${wpRoomCode}-${asHost ? 'host' : currentUser?.id}`; wpPeer = new Peer(peerId);
    wpPeer.on('open', () => { if (!asHost) { const conn = wpPeer.connect(`shush-${wpRoomCode}-host`, { metadata: { displayName: currentUser?.user_metadata?.display_name || 'ضيف' } }); setupConnection(conn); } });
    wpPeer.on('connection', setupConnection); wpPeer.on('error', () => { if (!asHost) showJoinError('❌ فشل الاتصال.'); });
    window.addEventListener('message', ({ origin, data }) => {
        const allowedOrigins = ['https://vidfast.pro', 'https://player.videasy.net', 'https://vidsrc-embed.ru', 'https://mapple.uk'];
        if (!allowedOrigins.some(o => origin.startsWith(o)) || !data) return;
        if (data.type === 'PLAYER_EVENT') {
            const { event: e, currentTime: t, playing: p } = data.data;
            if (e === 'waiting' || e === 'seeking') isBuffering = true;
            else if (e === 'playing' || e === 'canplay') isBuffering = false;
            if (t !== undefined) lastSyncTime = t;
            if (p !== undefined) lastSyncPlaying = p;
            if (wpIsHost && ['play','pause','seeked','playerstatus'].includes(e)) {
                broadcastToPeers({ type: 'sync', command: (e==='play'||p)?'play':'pause', time: t });
            }
        }
    });
}
async function createWatchParty() { 
    if (!currentUser) { showLogin(); return; } 
    closeDetail(); 
    wpRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase(); 
    wpIsHost = true; 
    const token = JSON.parse(localStorage.getItem('shush_session')).access_token; 
    try { 
        await gatewayRequest('rooms', 'POST', { host_id: currentUser.id, movie_id: String(curItem.id), movie_title: curItem.title || curItem.name, movie_poster: curItem.poster_path ? `${IMG}w300${curItem.poster_path}` : '', media_type: curType, season: curSeason, episode: curEp, room_code: wpRoomCode, is_active: true }, token); 
    } catch(e) {} 
    openWatchPartyUI(); 
    initPeer(true); 
}
async function joinWatchParty(code) { 
    if (!currentUser) { pendingRoomCode = code; showLogin(); return; } 
    showJoinSplash('🎉 جاري الانضمام...'); 
    wpRoomCode = code; 
    wpIsHost = false; 
    const token = JSON.parse(localStorage.getItem('shush_session')).access_token; 
    try { 
        const rooms = await gatewayRequest('rooms', 'GET', { room_code: code }, token); 
        if (rooms && rooms.length > 0 && rooms[0].is_active !== false) { 
            const r = rooms[0]; 
            curItem = { id: r.movie_id, title: r.movie_title, poster_path: r.movie_poster?.replace(IMG+'w300',''), media_type: r.media_type }; 
            curType = r.media_type; 
            curSeason = r.season; 
            curEp = r.episode; 
            hideJoinSplash(); 
            openWatchPartyUI(); 
            initPeer(false); 
        } else showJoinError('❌ الغرفة غير متاحة'); 
    } catch(e) { showJoinError('❌ فشل الانضمام'); } 
}

// 🔥 دالة openWatchPartyUI (مثل Novacast - بدون referrerpolicy)
function openWatchPartyUI() { 
    toggleModal('watchPartyModal', true); 
    document.body.style.overflow = 'hidden'; 
    $('wpPlayerPlaceholder').style.display = 'none'; 
    $('wpPlayerFrame').style.display = 'block'; 
    $('wpPlayerFrame').src = SRCS[0](curType, curItem.id, curSeason, curEp); 
    $('wpPlayerFrame').onload = () => {
        if ($('wpPlayerFrame').hasAttribute('sandbox')) {
            $('wpPlayerFrame').removeAttribute('sandbox');
        }
    };
    $('wpChat').innerHTML = ''; 
    $('wpEndBtn').style.display = wpIsHost ? 'flex' : 'none'; 
    updateUsersList(); 
    if (wpIsHost && !syncTimer) {
        syncTimer = setInterval(() => {
            if (lastSyncTime) broadcastToPeers({ type: 'sync', command: lastSyncPlaying ? 'play' : 'pause', time: lastSyncTime });
        }, 3000);
    }
}
function closeWatchParty() { 
    toggleModal('watchPartyModal', false); 
    document.body.style.overflow = ''; 
    $('wpPlayerFrame').src = ''; 
    broadcastToPeers({ type: 'leave' }); 
    if (wpPeer) { wpPeer.destroy(); wpPeer = null; } 
    wpConnections = []; 
    wpRoomCode = null; 
    wpIsHost = false; 
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}
async function endWatchParty() { 
    if (!wpIsHost) return; 
    if (confirm('إنهاء الغرفة؟')) { 
        wpConnections.forEach(c => c.send({ type: 'kick' })); 
        try { const token = JSON.parse(localStorage.getItem('shush_session')).access_token; await gatewayRequest('rooms', 'PUT', { id: wpRoomCode, is_active: false }, token); } catch(e) {} 
        showToast('تم إنهاء الغرفة'); 
        closeWatchParty(); 
    } 
}
function inviteFriendsToRoom() { 
    if (friends.length === 0) { showToast('لا يوجد أصدقاء'); return; } 
    const list = $('inviteFriendsList'); 
    list.innerHTML = friends.map(f => `<div class="friend-item"><div class="finfo"><div class="favatar">${f.avatar||'👤'}</div><span>${f.display_name}</span></div><button class="login-btn" style="width:auto;padding:6px 12px;font-size:11px;" onclick="sendRoomInvite('${f.id}')">دعوة</button></div>`).join(''); 
    toggleModal('inviteFriendsModal', true); 
}
async function sendRoomInvite(friendId) { 
    try {
        const { error } = await dbClient.from('notifications').insert({ user_id: friendId, type: 'room_invite', sender_id: currentUser.id, message: 'يدعوك لمشاهدة عمل معاً', data: { roomCode: wpRoomCode } }); 
        if (error) throw error;
        showToast('✅ تم إرسال الدعوة'); closeInviteModal(); 
    } catch (e) { console.error(e); showToast('❌ فشل الإرسال'); }
}

// ========== KEYBOARD & INIT ==========
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ if($('ppage').classList.contains('open'))closePlayer(); else if($('dov').classList.contains('open'))closeDetail(); else if($('trailerModal').classList.contains('active'))closeTrailer(); else if($('watchPartyModal').classList.contains('active'))closeWatchParty(); else if($('loginModal').classList.contains('active'))closeLoginModal(); else if($('settingsModal').classList.contains('active'))closeSettings(); else if($('friendsModal').classList.contains('active'))closeFriends(); else if($('adminModal').classList.contains('active'))closeAdmin(); else if($('recommendModal').classList.contains('active'))closeRecommendModal(); else if($('dmModal').classList.contains('active'))closeDMModal(); else if($('notificationsModal').classList.contains('active'))closeNotifications(); } });
$('wpMessageInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });

async function checkSession() { const saved = localStorage.getItem('shush_session'); if (saved) { try { const session = JSON.parse(saved); const { data } = await authGateway('getSession', { sessionToken: session.access_token }); if (data && data.user) { currentUser = data.user; await loadUserData(); updateUIAfterLogin(); } } catch(e) {} } }
async function getProgress(movieId, type, season, episode) { return null; }

(async function() { 
    const splash = document.getElementById('splash-screen');
    const minSplashTime = new Promise(resolve => setTimeout(resolve, 700));
    try {
        await Promise.all([init(), checkSession(), minSplashTime]); 
        const code = new URLSearchParams(window.location.search).get('room'); 
        if (code) { 
            if (!currentUser) { pendingRoomCode = code; showLogin(); } 
            else { showJoinSplash('🎉 جاري الانضمام...'); await joinWatchParty(code); } 
        } 
        originalMainHTML = $('main').innerHTML; 
    } catch (e) { console.error(e); } finally {
        if (splash) { splash.classList.add('fade-out'); setTimeout(() => splash.remove(), 300); }
    }
})();
