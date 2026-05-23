// ========== CONFIGURATION ==========
const API_GATEWAY = 'https://rtyfpyvqgvqozprquusx.supabase.co/functions/v1/api-gateway';
const AUTH_GATEWAY = 'https://rtyfpyvqgvqozprquusx.supabase.co/functions/v1/auth-gateway';
const TMDB_KEY = '35647da404eda7b8b77497d758251d69';
const T = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

const SRCS = [
  (tp,id,s,e)=>tp==='movie' ? `https://vidfast.pro/movie/${id}?theme=FF006E` : `https://vidfast.pro/tv/${id}/${s}/${e}?theme=FF006E`,
  (tp,id,s,e)=>tp==='movie' ? `https://vidsrc-embed.ru/embed/movie/${id}` : `https://vidsrc-embed.ru/embed/tv/${id}/${s}-${e}`,
  (tp,id,s,e)=>tp==='movie' ? `https://player.videasy.net/movie/${id}?color=FF006E` : `https://player.videasy.net/tv/${id}/${s}/${e}?color=FF006E&episodeSelector=true`,
  (tp,id,s,e)=>tp==='movie' ? `https://mapple.uk/watch/movie/${id}` : `https://mapple.uk/watch/tv/${id}-${s}-${e}`,
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

// Watch Party
let wpChannel = null;
let wpMembers = [];
let wpIsHost = false;
let wpHostId = null;      // معرف المضيف الحقيقي (حتى يعرفه الضيف)
let wpRoomCode = null;
let pendingRoomCode = null;
let lastSyncTime = 0, isBuffering = false;
let progressTimer = null;

const VIDFAST_ORIGINS = [
    'https://vidfast.pro', 'https://vidfast.in', 'https://vidfast.io',
    'https://vidfast.me', 'https://vidfast.net', 'https://vidfast.pm', 'https://vidfast.xyz'
];

const PRESET_AVATARS = ['👨','👩','👦','👧','🦸‍♂️','🦸‍♀️','🥷','🧛‍♂️','🧚‍♀️','🕵️‍♂️','🧑‍🚀','🦁','🐼','🦊','🦉'];
const $ = id => document.getElementById(id) || document.createElement('div');

function removeSandboxFromVideoIframes() {
    const videoIframes = document.querySelectorAll('#pframe, #wpPlayerFrame, #trailerFrame');
    videoIframes.forEach(iframe => { if (iframe.hasAttribute('sandbox')) iframe.removeAttribute('sandbox'); });
}
const sandboxObserver = new MutationObserver(() => removeSandboxFromVideoIframes());
sandboxObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['sandbox'] });

// ========== UI HELPERS ==========
function toggleModal(modalId, show) {
    const modal = $(modalId);
    if (modal) {
        if (show) {
            modal.classList.add('active');
            if (['inviteFriendsModal', 'recommendModal', 'dmModal', 'notificationsModal'].includes(modalId)) modal.style.display = 'flex';
        } else {
            modal.classList.remove('active');
            if (['inviteFriendsModal', 'recommendModal', 'dmModal', 'notificationsModal'].includes(modalId)) modal.style.display = 'none';
            if (modalId === 'dmModal') {
                currentDMUser = null;   // <-- أضف هذا السطر
            }
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
    let t = $('toast');
    if (t) { t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2500); }
}

function showNotification(notif) {
   if (notif.type === 'direct_message' && currentDMUser && notif.sender_id === currentDMUser) {
        // فقط نقوم بتحديث قائمة الإشعارات في الخلفية ولكن لا نعرض إشعاراً منبثقاً
        loadNotifications();
        return;
    }
    if ($('ppage') && ($('ppage').classList.contains('open') || ($('watchPartyModal') && $('watchPartyModal').classList.contains('active')))) {
        loadNotifications();
        return;
    }
    const toast = document.createElement('div');
    toast.className = 'fancy-toast notif-toast';
    let icon = '🔔', text = notif.message || 'إشعار جديد', btnText = '', btnAction = '';
    if (notif.type === 'friend_request') {
        icon = '📩'; text = 'طلب صداقة جديد'; btnText = 'عرض الطلبات'; btnAction = 'openFriends(); this.parentElement.remove();';
    } else if (notif.type === 'room_invite') {
        icon = '🎬'; text = (notif.sender && notif.sender.display_name ? notif.sender.display_name : 'صديق') + ' يدعوك للمشاهدة!';
        btnText = 'قبول وانضمام'; btnAction = 'joinWatchParty(\'' + (notif.data && notif.data.roomCode ? notif.data.roomCode : '') + '\'); this.parentElement.remove();';
    } else if (notif.type === 'recommendation') {
        icon = '⭐'; text = (notif.sender && notif.sender.display_name ? notif.sender.display_name : 'صديق') + ' يرشح لك هذا العمل';
        btnText = 'عرض التفاصيل'; btnAction = 'openRecommendedMovie(\'' + (notif.data && notif.data.movie_id ? notif.data.movie_id : '') + '\', \'' + (notif.data && notif.data.media_type ? notif.data.media_type : 'movie') + '\'); this.parentElement.remove();';
    } else if (notif.type === 'direct_message') {
        icon = '💬'; text = 'رسالة جديدة من ' + (notif.sender && notif.sender.display_name ? notif.sender.display_name : 'صديق');
        btnText = 'رد على الرسالة'; btnAction = 'openDM(\'' + notif.sender_id + '\', \'' + (notif.sender && notif.sender.display_name ? notif.sender.display_name : 'صديق') + '\'); this.parentElement.remove();';
    } else { return; }
    toast.innerHTML = '<div style="display:flex;align-items:center;gap:12px;width:100%;"><div style="font-size:24px">' + icon + '</div><div style="font-size:14px;font-weight:700;">' + text + '</div></div><button onclick="' + btnAction + '" class="fancy-toast-btn">' + btnText + '</button>';
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 8000);
    loadNotifications();
}
async function openRecommendedMovie(id, type) {
    try { const item = await fetchDetail(type, id); if (item) openDetail(item); } catch (e) { showToast('عذراً، المحتوى غير متوفر'); }
}

// ========== AUTH & API ==========
async function gatewayRequest(path, method, body, token) {
    const response = await fetch(API_GATEWAY, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path:path, method:method, body:body, token:token}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'فشل الطلب');
    return data;
}
async function authGateway(action, payload) {
    const response = await fetch(AUTH_GATEWAY, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:action, ...payload}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'فشل الطلب');
    return result;
}

// Login/Register events (مختصرة ولكنها موجودة في الكود الأصلي، سنكررها)
var tabLoginModal = $('tabLoginModal');
var tabRegisterModal = $('tabRegisterModal');
var btnLogin = $('btnLogin');
var btnRegister = $('btnRegister');

if (tabLoginModal) {
    tabLoginModal.addEventListener('click', function() {
        tabLoginModal.classList.add('active');
        if (tabRegisterModal) tabRegisterModal.classList.remove('active');
        var loginForm = $('loginFormModal');
        var registerForm = $('registerFormModal');
        if (loginForm) loginForm.style.display = 'block';
        if (registerForm) registerForm.style.display = 'none';
    });
}
if (tabRegisterModal) {
    tabRegisterModal.addEventListener('click', function() {
        tabRegisterModal.classList.add('active');
        if (tabLoginModal) tabLoginModal.classList.remove('active');
        var loginForm = $('loginFormModal');
        var registerForm = $('registerFormModal');
        if (registerForm) registerForm.style.display = 'block';
        if (loginForm) loginForm.style.display = 'none';
    });
}
if (btnLogin) {
    btnLogin.addEventListener('click', async function() {
        var email = $('loginEmail') ? $('loginEmail').value.trim() : '';
        var pass = $('loginPass') ? $('loginPass').value.trim() : '';
        var err = $('loginError');
        if (err) err.classList.remove('show');
        if (!email || !pass) {
            if (err) { err.textContent = 'يرجى إدخال البريد وكلمة المرور'; err.classList.add('show'); }
            return;
        }
        var originalText = btnLogin.textContent;
        btnLogin.innerHTML = '<span class="spin2" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-left:6px;"></span> جاري الدخول...';
        btnLogin.disabled = true;
        try {
            var result = await authGateway('login', { email: email, password: pass });
            var data = result.data;
            var error = result.error;
            if (error) {
                if (err) { err.textContent = error.message; err.classList.add('show'); }
                btnLogin.innerHTML = originalText;
                btnLogin.disabled = false;
            } else {
                currentUser = data.user;
                localStorage.setItem('shush_session', JSON.stringify(data.session));
                closeLoginModal();
                updateUIAfterLogin();
                var displayName = (currentUser.user_metadata && currentUser.user_metadata.display_name) ? currentUser.user_metadata.display_name : currentUser.email.split('@')[0];
                var greetingText = $('greetingText');
                if (greetingText) greetingText.textContent = '👋 أهلاً بك ' + displayName + '!';
                var greetingSplash = $('greetingSplash');
                if (greetingSplash) greetingSplash.classList.add('active');
                setTimeout(() => { if (greetingSplash) greetingSplash.classList.remove('active'); }, 2000);
                btnLogin.innerHTML = originalText;
                btnLogin.disabled = false;
                loadUserData().then(() => {
                    if (pendingRoomCode) {
                        joinWatchParty(pendingRoomCode);
                        pendingRoomCode = null;
                    }
                });
            }
        } catch(e) {
            if (err) { err.textContent = e.message; err.classList.add('show'); }
            btnLogin.innerHTML = originalText;
            btnLogin.disabled = false;
        }
    });
}
if (btnRegister) {
    btnRegister.addEventListener('click', async function() {
        var email = $('regEmail') ? $('regEmail').value.trim() : '';
        var pass = $('regPass') ? $('regPass').value.trim() : '';
        var confirm = $('regPassConfirm') ? $('regPassConfirm').value.trim() : '';
        var name = $('regName') ? $('regName').value.trim() : '';
        var err = $('regError');
        if (err) err.classList.remove('show');
        if (!email || !pass || !confirm) {
            if (err) { err.textContent = 'يرجى ملء جميع الحقول'; err.classList.add('show'); }
            return;
        }
        if (pass !== confirm) {
            if (err) { err.textContent = 'كلمتا المرور غير متطابقتين'; err.classList.add('show'); }
            return;
        }
        try {
            var result = await authGateway('register', { email: email, password: pass, displayName: name });
            var error = result.error;
            if (error) {
                if (err) { err.textContent = error.message; err.classList.add('show'); }
            } else {
                alert('تم إنشاء الحساب بنجاح! سجل دخول الآن.');
                if (tabLoginModal) tabLoginModal.click();
                var loginEmail = $('loginEmail');
                if (loginEmail) loginEmail.value = email;
            }
        } catch(e) {
            if (err) { err.textContent = e.message; err.classList.add('show'); }
        }
    });
}

async function logout() {
    closeWatchParty();
    await authGateway('logout', {});
    localStorage.removeItem('shush_session');
    currentUser = null;
    currentFavs = [];
    currentHistory = [];
    dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    var userBtn = $('userBtn');
    var userInfo = $('userInfo');
    var notifBtn = $('notifBtn');
    if (userBtn) userBtn.style.display = 'flex';
    if (userInfo) userInfo.style.display = 'none';
    if (notifBtn) notifBtn.style.display = 'none';
    showAllSections();
    var greetingText = $('greetingText');
    if (greetingText) greetingText.textContent = '👋 إلى اللقاء!';
    var greetingSplash = $('greetingSplash');
    if (greetingSplash) greetingSplash.classList.add('active');
    setTimeout(() => { if (greetingSplash) greetingSplash.classList.remove('active'); }, 2000);
    if (notificationChannel) notificationChannel.unsubscribe();
}
function updateUIAfterLogin() {
    $('userBtn').style.display = 'none';
    $('userInfo').style.display = 'flex';
    $('notifBtn').style.display = 'flex';
    const avatarEmoji = currentUser.user_metadata?.avatar || '😊';
   $('userEmoji').innerHTML = avatarToIcon(currentUser.user_metadata?.avatar || '😊');
    $('userName').textContent = currentUser.user_metadata?.display_name || currentUser.email;
}
function toggleUserDropdown() {
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}
function closeUserDropdown() {
    const dropdown = $('userDropdown');
    if (dropdown) dropdown.classList.remove('show');
}
// ========== DATA LOADING & REALTIME ==========
var notificationChannel = null;
async function loadUserData() {
    if (!currentUser) return;
    try {
        var session = JSON.parse(localStorage.getItem('shush_session'));
        if (!session) return;
        var token = session.access_token;
        dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: 'Bearer ' + token } } });
        dbClient.realtime.setAuth(token);
        var profResult = await dbClient.from('profiles').select('is_banned').eq('id', currentUser.id).single();
        var prof = profResult.data;
        if (prof && prof.is_banned) {
            alert('حسابك محظور من قبل الإدارة.');
            logout();
            return;
        }
        currentFavs = (await gatewayRequest('favorites', 'GET', { columns: '*' }, token)) || [];
        currentHistory = (await gatewayRequest('history', 'GET', { columns: '*' }, token)) || [];
        await loadFriends();
        await loadFriendRequests();
        await loadNotifications();
        await checkAdmin();
        if (curTab === 'fav') renderFavorites();
        if (curTab === 'hist') renderHistory();
        subscribeToRealtime();
    } catch(e) { console.error(e); }
}

function subscribeToRealtime() {
    if (!currentUser) return;
    if (notificationChannel) dbClient.removeChannel(notificationChannel);
    notificationChannel = dbClient.channel('custom-user-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + currentUser.id }, async function(payload) {
            var newNotif = payload.new;
            var senderResult = await dbClient.from('profiles').select('display_name, avatar').eq('id', newNotif.sender_id).single();
            var senderData = senderResult.data;
            newNotif.sender = senderData;
            showNotification(newNotif);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `receiver_id=eq.${currentUser.id}` }, async payload => {
    if (currentDMUser === payload.new.sender_id) {
        loadDMs(currentDMUser);
    } else {
        // فقط إذا لم تكن نافذة الدردشة مفتوحة نعرض إشعارًا
        if (!currentDMUser) {
            const { data: senderData } = await dbClient.from('profiles').select('display_name, avatar').eq('id', payload.new.sender_id).single();
            showNotification({ type: 'direct_message', sender_id: payload.new.sender_id, sender: senderData });
        }
    }
})
        .subscribe(function(status, err) {
            console.log("📡 حالة التحديث اللحظي:", status);
            if (err) console.error(err);
        });
}

// ========== NOTIFICATIONS ==========
async function loadNotifications() {
    if (!currentUser) return;
    var notifsResult = await dbClient.from('notifications').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(30);
    var notifs = notifsResult.data;
    if (!notifs || notifs.length === 0) {
        allNotifications = [];
    } else {
        var senderIds = [];
        for (var i = 0; i < notifs.length; i++) {
            if (notifs[i].sender_id) senderIds.push(notifs[i].sender_id);
        }
        var uniqueIds = [...new Set(senderIds)];
        var sendersResult = await dbClient.from('profiles').select('id, display_name, avatar').in('id', uniqueIds);
        var senders = sendersResult.data || [];
        allNotifications = notifs.map(function(n) {
            var s = senders.find(function(p) { return p.id === n.sender_id; });
            return Object.assign({}, n, { sender: s || null });
        });
    }
    var unreadCount = allNotifications.filter(function(n) { return !n.is_read; }).length;
    var badge = $('notifBadge');
    if (badge) {
        if (unreadCount > 0) {
            badge.style.display = 'flex';
            badge.textContent = unreadCount;
        } else {
            badge.style.display = 'none';
        }
    }
}
function openNotifications() {
    toggleModal('notificationsModal', true);
    var list = $('notificationsList');
    if (!list) return;
    if (allNotifications.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:var(--t3);padding:20px;">لا توجد إشعارات</p>';
        return;
    }
    list.innerHTML = allNotifications.map(function(n) {
        var sName = (n.sender && n.sender.display_name) ? n.sender.display_name : 'مستخدم';
        var sAv = (n.sender && n.sender.avatar) ? n.sender.avatar : '👤';
        var actionHtml = '';
        if (n.type === 'friend_request') {
            actionHtml = '<button class="login-btn" style="width:auto;padding:4px 10px;font-size:10px" onclick="openFriends();closeNotifications()">عرض الطلبات</button>';
        } else if (n.type === 'room_invite') {
            actionHtml = '<button class="login-btn" style="width:auto;padding:4px 10px;font-size:10px;background:var(--green)" onclick="joinWatchParty(\'' + (n.data && n.data.roomCode ? n.data.roomCode : '') + '\');closeNotifications()">انضمام</button>';
        } else if (n.type === 'recommendation') {
            actionHtml = '<button class="login-btn" style="width:auto;padding:4px 10px;font-size:10px" onclick="openRecommendedMovie(\'' + (n.data && n.data.movie_id ? n.data.movie_id : '') + '\',\'' + (n.data && n.data.media_type ? n.data.media_type : 'movie') + '\');closeNotifications()">مشاهدة</button>';
        }
        return '<div class="friend-item" style="opacity:' + (n.is_read ? 0.6 : 1) + '; cursor:pointer;" onclick="markNotifRead(\'' + n.id + '\')"><div class="finfo"><div class="favatar">' + sAv + '</div><div style="display:flex;flex-direction:column"><span>' + sName + '</span><span style="font-size:10px;color:var(--t2)">' + n.message + '</span></div></div><div style="display:flex;gap:6px">' + actionHtml + '<button class="login-btn" style="width:auto;padding:4px 8px;font-size:10px;background:#ef4444" onclick="event.stopPropagation();deleteNotif(\'' + n.id + '\')">🗑️</button></div></div>';
    }).join('');
}
async function markNotifRead(id) {
    await dbClient.from('notifications').update({ is_read: true }).eq('id', id);
    loadNotifications();
    setTimeout(openNotifications, 200);
}
async function deleteNotif(id) {
    await dbClient.from('notifications').delete().eq('id', id);
    loadNotifications();
    setTimeout(openNotifications, 200);
}

// ========== DIRECT MESSAGES ==========
async function openDM(friendId, friendName) {
    currentDMUser = friendId;
    var dmTitle = $('dmTitle');
    if (dmTitle) dmTitle.textContent = 'الدردشة مع ' + friendName;
    toggleModal('dmModal', true);
    loadDMs(friendId);
    // حذف الإشعارات المرتبطة بهذه المحادثة
    await dbClient.from('notifications').delete().eq('user_id', currentUser.id).eq('type', 'direct_message').eq('sender_id', friendId);
    loadNotifications();
}
async function loadDMs(friendId) {
    var list = $('dmList');
    if (!list) return;
    list.innerHTML = '<div class="spinner" style="margin:auto"></div>';
    var dataResult = await dbClient.from('direct_messages').select('*').or('and(sender_id.eq.' + currentUser.id + ',receiver_id.eq.' + friendId + '),and(sender_id.eq.' + friendId + ',receiver_id.eq.' + currentUser.id + ')').order('created_at', { ascending: true });
    var data = dataResult.data;
    if (!data || data.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:var(--t3);padding:20px;">لا توجد رسائل سابقة</p>';
        return;
    }
    list.innerHTML = data.map(function(msg) {
        var isMe = msg.sender_id === currentUser.id;
        return '<div style="display:flex; justify-content:' + (isMe ? 'flex-end' : 'flex-start') + '; margin-bottom:8px;"><div style="background:' + (isMe ? 'var(--accent)' : 'var(--bg4)') + '; color:' + (isMe ? '#000' : 'var(--t1)') + '; padding:8px 14px; border-radius:14px; font-size:12px; max-width:75%;">' + msg.content + '</div></div>';
    }).join('');
    list.scrollTop = list.scrollHeight;
    await dbClient.from('direct_messages').update({ is_read: true }).eq('sender_id', friendId).eq('receiver_id', currentUser.id);
}
async function sendDMsg() {
    var input = $('dmInput');
    var msg = input ? input.value.trim() : '';
    if (!msg || !currentDMUser) return;
    if (input) input.value = '';
    await dbClient.from('direct_messages').insert({ sender_id: currentUser.id, receiver_id: currentDMUser, content: msg });
    loadDMs(currentDMUser);
    await dbClient.from('notifications').insert({ user_id: currentDMUser, sender_id: currentUser.id, type: 'direct_message', message: 'أرسل لك رسالة خاصة' });
}

// ========== RECOMMENDATIONS ==========
function openRecommendModal() {
    if (!currentUser) { showLogin(); return; }
    if (friends.length === 0) { showToast('يجب إضافة أصدقاء أولاً'); return; }
    toggleModal('recommendModal', true);
    var recMessage = $('recMessage');
    if (recMessage) recMessage.value = 'أنصحك بمشاهدة هذا العمل الرائع!';
    var list = $('recFriendsList');
    if (list) {
        list.innerHTML = friends.map(function(f) {
            return '<div class="friend-item"><div class="finfo"><div class="favatar">' + (f.avatar || '👤') + '</div><span>' + f.display_name + '</span></div><button class="login-btn" style="width:auto;padding:6px 14px;font-size:11px;" onclick="sendRecommendation(\'' + f.id + '\')">إرسال 💌</button></div>';
        }).join('');
    }
}
async function sendRecommendation(friendId) {
    if (!curItem) return;
    var msgInput = $('recMessage');
    var msg = msgInput ? (msgInput.value.trim() || 'أنصحك بمشاهدة هذا العمل!') : 'أنصحك بمشاهدة هذا العمل!';
    var safeData = { movie_id: curItem.id || '', media_type: curType || 'movie', title: (curItem.title || curItem.name || 'عمل فني'), poster: curItem.poster_path || '' };
    try {
        var error = await dbClient.from('notifications').insert({ user_id: friendId, sender_id: currentUser.id, type: 'recommendation', message: msg, data: safeData });
        if (error && error.error) throw error.error;
        showToast('✅ تم إرسال التوصية لصديقك');
        closeRecommendModal();
    } catch(e) {
        console.error(e);
        showToast('❌ فشل الإرسال');
    }
}

// ========== FRIENDS ==========
function openFriends() {
    if (!currentUser) { showLogin(); return; }
    toggleModal('friendsModal', true);
    loadFriendRequests();
    loadFriends();
}
async function searchFriend() {
    var q = $('friendSearchInput') ? $('friendSearchInput').value.trim() : '';
    if (!q) return;
    var resultDiv = $('friendSearchResult');
    if (!resultDiv) return;
    resultDiv.innerHTML = '<p style="color:var(--t2);">جاري البحث...</p>';
    var dataResult = await dbClient.from('profiles').select('id, display_name, avatar').ilike('display_name', '%' + q + '%').limit(10);
    var data = dataResult.data;
    if (data && data.length > 0) {
        resultDiv.innerHTML = data.filter(function(u) { return u.id !== currentUser.id; }).map(function(u) {
            var isFriend = friends.some(function(f) { return f.id === u.id; });
            var btnHtml = isFriend ? '<span style="font-size:10px;color:var(--green);background:var(--bg4);padding:4px 8px;border-radius:10px;">صديق لديك</span>' : '<button class="login-btn" style="width:auto;padding:6px 14px;font-size:11px;" onclick="sendFriendRequest(\'' + u.id + '\')">إضافة ➕</button>';
            return '<div class="friend-item"><div class="finfo"><div class="favatar">' + (u.avatar || '👤') + '</div><span>' + u.display_name + '</span></div>' + btnHtml + '</div>';
        }).join('');
    } else {
        resultDiv.innerHTML = '<p style="color:var(--t3);">لا يوجد نتائج</p>';
    }
}
async function sendFriendRequest(receiverId) {
    var errorResult = await dbClient.from('friend_requests').insert({ sender_id: currentUser.id, receiver_id: receiverId, status: 'pending' });
    if (errorResult.error) {
        showToast('⚠️ فشل إرسال الطلب');
        return;
    }
    await dbClient.from('notifications').insert({ user_id: receiverId, type: 'friend_request', sender_id: currentUser.id, message: 'طلب صداقة جديد' });
    showToast('✅ تم الإرسال');
}
async function loadFriendRequests() {
    if (!currentUser) return;
    var requestsResult = await dbClient.from('friend_requests').select('*').eq('receiver_id', currentUser.id).eq('status', 'pending');
    var requests = requestsResult.data;
    if (!requests || requests.length === 0) {
        friendRequests = [];
    } else {
        var senderIds = [];
        for (var i = 0; i < requests.length; i++) {
            if (requests[i].sender_id) senderIds.push(requests[i].sender_id);
        }
        var uniqueIds = [...new Set(senderIds)];
        var sendersResult = await dbClient.from('profiles').select('id, display_name, avatar').in('id', uniqueIds);
        var senders = sendersResult.data || [];
        friendRequests = requests.map(function(req) {
            var s = senders.find(function(p) { return p.id === req.sender_id; });
            return Object.assign({}, req, { sender: s || null });
        });
    }
    renderFriendRequestsUI();
}
function renderFriendRequestsUI() {
    var list = $('friendRequestsList');
    if (!list) return;
    if (friendRequests.length === 0) {
        list.innerHTML = '<p style="color:var(--t3);">لا توجد طلبات</p>';
        return;
    }
    list.innerHTML = friendRequests.map(function(req) {
        var avatarHtml = avatarToIcon((req.sender && req.sender.avatar) || '👤');
        var sName = (req.sender && req.sender.display_name) ? req.sender.display_name : 'مستخدم';
        return '<div class="request-item"><div class="finfo"><div class="favatar">' + avatarHtml + '</div><span>' + sName + '</span></div><div style="display:flex;gap:6px;"><button class="login-btn" style="width:auto;padding:4px 8px;font-size:10px;background:var(--green);" onclick="acceptFriendRequest(\'' + req.id + '\', \'' + req.sender_id + '\')">✅</button><button class="login-btn" style="width:auto;padding:4px 8px;font-size:10px;background:#ef4444;" onclick="rejectFriendRequest(\'' + req.id + '\', \'' + req.sender_id + '\')">❌</button></div></div>';
    }).join('');
}
async function acceptFriendRequest(requestId, senderId) {
    // إضافة الصداقة في جدول friends
    await dbClient.from('friends').insert([ { user_id: currentUser.id, friend_id: senderId }, { user_id: senderId, friend_id: currentUser.id } ]);
    // حذف طلب الصداقة
    await dbClient.from('friend_requests').delete().eq('id', requestId);
    // تحديث المصفوفة المحلية وإعادة رسم الواجهة
    friendRequests = friendRequests.filter(req => req.id !== requestId);
    renderFriendRequestsUI();
    // حذف الإشعارات المرتبطة بهذا الطلب
    await dbClient.from('notifications').delete().eq('user_id', currentUser.id).eq('type', 'friend_request').eq('sender_id', senderId);
    loadNotifications();
    showToast('✅ تم قبول الصداقة');
    // تحديث قائمة الأصدقاء
    await loadFriends();
}
async function rejectFriendRequest(requestId, senderId) {
    // حذف طلب الصداقة
    await dbClient.from('friend_requests').delete().eq('id', requestId);
    // تحديث المصفوفة المحلية وإعادة رسم الواجهة
    friendRequests = friendRequests.filter(req => req.id !== requestId);
    renderFriendRequestsUI();
    // حذف الإشعارات المرتبطة بهذا الطلب
    await dbClient.from('notifications').delete().eq('user_id', currentUser.id).eq('type', 'friend_request').eq('sender_id', senderId);
    loadNotifications();
    showToast('❌ تم رفض الطلب');
}
async function loadFriends() {
    if (!currentUser) return;
    var friendRowsResult = await dbClient.from('friends').select('friend_id').eq('user_id', currentUser.id);
    var friendRows = friendRowsResult.data;
    if (!friendRows || friendRows.length === 0) {
        friends = [];
    } else {
        var fIds = friendRows.map(function(f) { return f.friend_id; });
        var profilesResult = await dbClient.from('profiles').select('id, display_name, avatar').in('id', fIds);
        friends = profilesResult.data || [];
    }
    renderFriendsListUI();
}
function renderFriendsListUI() {
    var list = $('friendsList');
    if (!list) return;
    if (friends.length === 0) {
        list.innerHTML = '<p style="color:var(--t3);">لا يوجد أصدقاء</p>';
        return;
    }
    list.innerHTML = friends.map(function(f) {
        var avatarHtml = avatarToIcon(f.avatar || '👤');
        return '<div class="friend-item"><div class="finfo"><div class="favatar">' + avatarHtml + '</div><span>' + f.display_name + '</span></div><div style="display:flex;gap:6px;"><button class="login-btn" style="width:auto;padding:4px 10px;font-size:10px;" onclick="openDM(\'' + f.id + '\',\'' + f.display_name + '\')">💬</button><button class="login-btn" style="width:auto;padding:4px 10px;font-size:10px;background:transparent;color:#ef4444;border:1px solid #ef4444" onclick="removeFriend(\'' + f.id + '\')">🗑️</button></div></div>';
    }).join('');
}
async function removeFriend(friendId) {
    if (!confirm('إزالة الصديق؟')) return;
    await dbClient.from('friends').delete().eq('user_id', currentUser.id).eq('friend_id', friendId);
    await dbClient.from('friends').delete().eq('user_id', friendId).eq('friend_id', currentUser.id);
    showToast('تم إزالة الصديق');
    await loadFriends();
}

// ========== SETTINGS ==========
function openSettings() {
    closeUserDropdown();  // إغلاق القائمة أولاً
    if (!currentUser) return;
    // باقي الكود كما هو...
    if (!currentUser) return;
    var setDisplayName = $('setDisplayName');
    if (setDisplayName) setDisplayName.value = (currentUser.user_metadata && currentUser.user_metadata.display_name) ? currentUser.user_metadata.display_name : '';
    var setNewPass = $('setNewPass');
    if (setNewPass) setNewPass.value = '';
    var currentAvatar = (currentUser.user_metadata && currentUser.user_metadata.avatar) ? currentUser.user_metadata.avatar : '😊';
    var avatarSelection = $('avatarSelection');
    if (avatarSelection) {
        avatarSelection.innerHTML = PRESET_AVATARS.map(function(a) {
            return '<div class="favatar ' + (a === currentAvatar ? 'selected' : '') + '" style="cursor:pointer; border:' + (a === currentAvatar ? '2px solid var(--gold)' : 'none') + '" onclick="selectAvatar(this, \'' + a + '\')">' + a + '</div>';
        }).join('');
    }
    var selectedAvatarInput = $('selectedAvatarInput');
    if (selectedAvatarInput) selectedAvatarInput.value = currentAvatar;
    toggleModal('settingsModal', true);
}
function selectAvatar(el, avatar) {
    var avatars = document.querySelectorAll('#avatarSelection .favatar');
    for (var i = 0; i < avatars.length; i++) {
        avatars[i].style.border = 'none';
    }
    el.style.border = '2px solid var(--gold)';
    var selectedAvatarInput = $('selectedAvatarInput');
    if (selectedAvatarInput) selectedAvatarInput.value = avatar;
}
async function saveSettings() {
    const displayName = $('setDisplayName').value.trim();
    const avatar = $('selectedAvatarInput').value || '😊';
    const newPass = $('setNewPass').value.trim();
    if (!displayName) { showToast('⚠️ الاسم مطلوب'); return; }
    try {
        if (newPass) await authGateway('updatePassword', { password: newPass });
        
        // 1. تحديث قاعدة البيانات
        await dbClient.from('profiles').update({ display_name: displayName, avatar: avatar }).eq('id', currentUser.id);
        
        // 2. تحديث user_metadata محلياً (بدون إعادة تحميل كامل)
        currentUser.user_metadata = { ...currentUser.user_metadata, display_name: displayName, avatar: avatar };
        
        // 3. تحديث جميع أجزاء الواجهة
        updateUIAfterLogin();                      // شريط التنقل
        renderFriendsListUI();                    // قائمة الأصدقاء
        if (typeof renderFriendRequestsUI === 'function') renderFriendRequestsUI(); // طلبات الصداقة
        if (wpChannel && wpIsHost) updateUsersListBroadcast(); // غرفة المشاهدة
        
        closeSettings();
        closeUserDropdown();
        showToast('✅ تم الحفظ');
    } catch(e) {
        console.error(e);
        showToast('❌ فشل الحفظ');
    }
}
// ========== ADMIN ==========
async function checkAdmin() {
    if (!currentUser) return;
    var dataResult = await dbClient.from('profiles').select('role').eq('id', currentUser.id).single();
    var data = dataResult.data;
    isAdmin = data && data.role === 'admin';
    var adminMenuBtn = $('adminMenuBtn');
    if (adminMenuBtn) adminMenuBtn.style.display = isAdmin ? 'flex' : 'none';
}
function openAdmin() {
    closeUserDropdown();  // إغلاق القائمة أولاً
    if (!currentUser) return;
    // باقي الكود كما هو...
    if (!isAdmin) return;
    toggleModal('adminModal', true);
    var firstTab = document.querySelector('#adminModal .admin-tab');
    if (firstTab) switchAdminTab('stats', firstTab);
}
async function switchAdminTab(tab, btn) {
    var tabs = document.querySelectorAll('#adminModal .admin-tab');
    for (var i = 0; i < tabs.length; i++) { tabs[i].classList.remove('on'); }
    btn.classList.add('on');
    var sections = document.querySelectorAll('#adminModal .admin-section');
    for (var i = 0; i < sections.length; i++) { sections[i].classList.remove('on'); }
    var target = $('admin-' + tab);
    if (target) target.classList.add('on');
    if (tab === 'stats') loadAdminStats();
    else if (tab === 'users') loadAdminUsers();
    else if (tab === 'channels') loadAdminChannels();
}
async function loadAdminStats() {
    var div = $('admin-stats');
    if (!div) return;
    div.innerHTML = '<div class="spinner" style="margin:auto"></div>';
    var usersCountResult = await dbClient.from('profiles').select('*', { count: 'exact', head: true });
    var usersCount = usersCountResult.count || 0;
    var roomsCountResult = await dbClient.from('rooms').select('*', { count: 'exact', head: true }).eq('is_active', true);
    var roomsCount = roomsCountResult.count || 0;
    div.innerHTML = '<div style="display:flex;gap:10px;margin-bottom:20px;"><div style="flex:1;background:var(--bg3);padding:20px;border-radius:14px;text-align:center;border:1px solid var(--border)"><h3 style="color:var(--gold);font-size:24px;margin-bottom:5px">' + usersCount + '</h3><p style="font-size:12px;color:var(--t2)">إجمالي الأعضاء</p></div><div style="flex:1;background:var(--bg3);padding:20px;border-radius:14px;text-align:center;border:1px solid var(--border)"><h3 style="color:var(--green);font-size:24px;margin-bottom:5px">' + roomsCount + '</h3><p style="font-size:12px;color:var(--t2)">الغرف النشطة</p></div></div>';
}
async function loadAdminUsers() {
    var usersResult = await dbClient.from('profiles').select('*').order('created_at', { ascending: false });
    var users = usersResult.data || [];
    var div = $('admin-users');
    if (!div) return;
    div.innerHTML = '<div style="max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;">' + (users.length ? users.map(function(u) {
        return '<div class="friend-item" style="flex-wrap:wrap;"><div class="finfo" style="min-width:150px;"><div class="favatar">' + (u.avatar || '👤') + '</div><div style="display:flex;flex-direction:column"><span>' + u.display_name + '</span><span style="font-size:9px;color:var(--t3)">' + u.id.substring(0,8) + '... | ' + u.role + '</span></div></div><div style="display:flex;gap:4px;flex-wrap:wrap;"><button class="login-btn" style="width:auto;padding:4px 8px;font-size:10px;background:' + (u.is_banned ? '#10b981' : '#f59e0b') + ';" onclick="toggleBan(\'' + u.id + '\', ' + (u.is_banned ? true : false) + ')">' + (u.is_banned ? 'إلغاء حظر' : 'حظر 🚫') + '</button><button class="login-btn" style="width:auto;padding:4px 8px;font-size:10px;background:#4f46e5;" onclick="changeRole(\'' + u.id + '\', \'' + u.role + '\')">ترقية/عزل 👑</button><button class="login-btn" style="width:auto;padding:4px 8px;font-size:10px;background:#ef4444;" onclick="deleteUser(\'' + u.id + '\')">حذف 🗑️</button><button class="login-btn" style="width:auto;padding:4px 8px;font-size:10px;background:var(--bg4);color:var(--t1)" onclick="adminResetPassword(\'' + u.id + '\')">باسورد 🔑</button></div></div>';
    }).join('') : '<p>لا يوجد مستخدمين</p>') + '</div>';
}
async function toggleBan(uid, isBanned) {
    if (confirm('هل تريد ' + (isBanned ? 'إلغاء حظر' : 'حظر') + ' المستخدم؟')) {
        await dbClient.from('profiles').update({ is_banned: !isBanned }).eq('id', uid);
        loadAdminUsers();
        showToast('تم تحديث حالة الحظر');
    }
}
async function changeRole(uid, currentRole) {
    var newRole = currentRole === 'admin' ? 'user' : 'admin';
    if (confirm('هل تريد تحويل المستخدم إلى ' + newRole + '؟')) {
        await dbClient.from('profiles').update({ role: newRole }).eq('id', uid);
        loadAdminUsers();
        showToast('تم تحديث الرتبة');
    }
}
async function deleteUser(userId) {
    if (!confirm('حذف نهائي للمستخدم وكافة بياناته؟')) return;
    await dbClient.from('profiles').delete().eq('id', userId);
    showToast('تم الحذف');
    loadAdminUsers();
}
async function adminResetPassword(uid) {
    var newPass = prompt('أدخل كلمة المرور الجديدة للمستخدم:');
    if (newPass && newPass.length >= 6) {
        showToast('ميزة تغيير الباسورد تتطلب تحديث الـ Backend ⚠️');
    } else if (newPass) {
        alert('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    }
}
async function loadAdminChannels() {
    var channelsResult = await dbClient.from('channels').select('*').order('group_title').limit(100);
    var data = channelsResult.data || [];
    var div = $('admin-channels');
    if (!div) return;
    div.innerHTML = '<div style="display:flex;gap:8px;margin-bottom:12px;"><input class="login-input" id="adminChannelSearch" placeholder="🔍 بحث عن قناة..." style="margin-bottom:0;"><button class="login-btn" style="width:auto;padding:10px 16px;" onclick="searchAdminChannel()">بحث</button></div><div style="max-height:400px;overflow-y:auto;">' + (data.length ? data.map(function(ch) {
        return '<div class="friend-item"><div class="finfo"><img src="' + (ch.logo || '') + '" style="width:28px;height:28px;border-radius:6px;object-fit:contain;" onerror="this.style.display=\'none\'"><span style="font-size:12px;">' + ch.name + '</span><span style="font-size:10px;color:var(--t3);">' + (ch.group_title || '') + '</span></div><div style="display:flex;gap:4px;"><button class="login-btn" style="width:auto;padding:4px 8px;font-size:10px;background:' + (ch.is_active ? '#10b981' : '#ef4444') + '" onclick="toggleChannelActive(' + ch.id + ',' + (!ch.is_active) + ')">' + (ch.is_active ? 'نشط' : 'معطل') + '</button></div></div>';
    }).join('') : '<p>لا توجد قنوات</p>') + '</div>';
}
async function toggleChannelActive(id, active) {
    await dbClient.from('channels').update({ is_active: active }).eq('id', id);
    showToast(active ? '✅ تم تفعيل القناة' : '⏸️ تم تعطيل القناة');
    loadAdminChannels();
}
async function searchAdminChannel() {
    var input = $('adminChannelSearch');
    var q = input ? input.value.trim() : '';
    if (!q) {
        loadAdminChannels();
        return;
    }
    var channelsResult = await dbClient.from('channels').select('*').ilike('name', '%' + q + '%').limit(20);
    var data = channelsResult.data || [];
    var div = $('admin-channels');
    if (!div) return;
    div.innerHTML = '<div style="display:flex;gap:8px;margin-bottom:12px;"><input class="login-input" id="adminChannelSearch" placeholder="🔍 بحث..." value="' + q + '" style="margin-bottom:0;"><button class="login-btn" style="width:auto;padding:10px 16px;" onclick="searchAdminChannel()">بحث</button></div><div style="max-height:400px;overflow-y:auto;">' + (data.length ? data.map(function(ch) {
        return '<div class="friend-item"><div class="finfo"><span style="font-size:12px;">' + ch.name + '</span></div><button class="login-btn" style="width:auto;padding:4px 8px;font-size:10px;background:' + (ch.is_active ? '#10b981' : '#ef4444') + '" onclick="toggleChannelActive(' + ch.id + ',' + (!ch.is_active) + ')">' + (ch.is_active ? 'نشط' : 'معطل') + '</button></div>';
    }).join('') : '<p>لا توجد نتائج</p>') + '</div>';
}

// ========== TMDB & MEDIA ==========
function hideAllSections() {
    var secAll = $('sec-all'); if (secAll) secAll.style.display = 'none';
    var secFav = $('sec-fav'); if (secFav) secFav.style.display = 'none';
    var secHist = $('sec-hist'); if (secHist) secHist.style.display = 'none';
    var searchRes = $('search-results'); if (searchRes) searchRes.style.display = 'none';
}
function showAllSections() {
    var secAll = $('sec-all'); if (secAll) secAll.style.display = 'block';
    var secFav = $('sec-fav'); if (secFav) secFav.style.display = 'none';
    var secHist = $('sec-hist'); if (secHist) secHist.style.display = 'none';
    var searchRes = $('search-results'); if (searchRes) searchRes.style.display = 'none';
}
async function api(p) {
    var s = p.includes('?') ? '&' : '?';
    var response = await fetch(T + p + s + 'api_key=' + TMDB_KEY + '&language=ar');
    return response.json();
}

async function loadHero() {
    try {
        var r = await api('/trending/all/week');
        var items = (r.results || []).filter(function(x) { return x.poster_path && x.backdrop_path; });
        heroItems = items.slice(0, 6);
        var slider = $('heroSlider');
        var oldSlides = document.querySelectorAll('.hero-slide');
        for (var i = 0; i < oldSlides.length; i++) oldSlides[i].remove();
        for (var i = 0; i < heroItems.length; i++) {
            var item = heroItems[i];
            var slide = document.createElement('div');
            slide.className = 'hero-slide' + (i === 0 ? ' active' : '');
            slide.style.backgroundImage = 'url(' + IMG + 'original' + item.backdrop_path + ')';
            slider.insertBefore(slide, slider.firstChild);
        }
        var dotsContainer = $('heroDots');
        dotsContainer.innerHTML = heroItems.map(function(_, i) {
            return '<button class="hdot' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '"></button>';
        }).join('');
        var dots = document.querySelectorAll('.hdot');
        for (var i = 0; i < dots.length; i++) {
            dots[i].addEventListener('click', function(e) {
                var idx = parseInt(e.currentTarget.getAttribute('data-idx'));
                goToHero(idx);
            });
        }
        updateHeroInfo(0);
        startHeroTimer();
        appendCards('g-trend', r.results || []);
    } catch(e) { console.error(e); }
}
function updateHeroInfo(idx) {
    var item = heroItems[idx];
    if (!item) return;
    heroIdx = idx;
    var isM = item.media_type === 'movie' || item.title;
    var htitle = $('htitle');
    if (htitle) htitle.textContent = item.title || item.name;
    var hdesc = $('hdesc');
    if (hdesc) hdesc.textContent = item.overview || '';
    var hmeta = $('hmeta');
    if (hmeta) {
        hmeta.innerHTML = '<span>⭐ ' + (item.vote_average || 0).toFixed(1) + '</span><span>' + (item.release_date || item.first_air_date || '').slice(0,4) + '</span><span style="background:var(--bg4);padding:2px 6px;border-radius:6px">' + (isM ? 'فيلم' : 'مسلسل') + '</span>';
    }
}
function goToHero(idx) {
    clearInterval(heroTimer);
    var slides = document.querySelectorAll('.hero-slide');
    for (var i = 0; i < slides.length; i++) slides[i].classList.toggle('active', i === idx);
    var dots = document.querySelectorAll('.hdot');
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('active', i === idx);
    updateHeroInfo(idx);
    startHeroTimer();
}
function startHeroTimer() {
    clearInterval(heroTimer);
    heroTimer = setInterval(function() {
        goToHero((heroIdx + 1) % heroItems.length);
    }, 5000);
}
function heroWatch() {
    if (heroItems[heroIdx]) openDetail(heroItems[heroIdx]);
}

async function initGenres() {
    try {
        var r = await api('/genre/movie/list');
        allGenres = r.genres.slice(0, 14);
        var genreBar = $('genreBar');
        if (genreBar) {
            genreBar.innerHTML = '<button class="gbtn on" onclick="clearGenre(this)">🔥 الكل</button>' + allGenres.map(function(g) {
                return '<button class="gbtn" onclick="pickGenre(' + g.id + ',\'' + g.name + '\',this)">' + g.name + '</button>';
            }).join('');
        }
    } catch(e) {}
}
function clearGenre(el) {
    var btns = document.querySelectorAll('.gbtn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('on');
    el.classList.add('on');
    showAllSections();
    var dyn = document.querySelector('#sec-genre-dynamic');
    if (dyn) dyn.remove();
}
async function pickGenre(id, name, el) {
    var btns = document.querySelectorAll('.gbtn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('on');
    el.classList.add('on');
    hideAllSections();
    var dyn = document.querySelector('#sec-genre-dynamic');
    if (dyn) dyn.remove();
    var mt = curTab === 'tv' ? 'tv' : 'movie';
    var r = await api('/discover/' + mt + '?with_genres=' + id + '&page=1');
    var items = (r.results || []).slice(0, 18);
    var sec = document.createElement('div');
    sec.className = 'sec';
    sec.id = 'sec-genre-dynamic';
    sec.innerHTML = '<div class="sec-h"><div class="sec-t"><div class="bar"></div>🎬 ' + name + '</div></div><div class="grid"></div>';
    var grid = sec.querySelector('.grid');
    for (var i = 0; i < items.length; i++) { grid.appendChild(mkCard(items[i])); }
    var main = $('main');
    if (main) main.prepend(sec);
}

var fetchMov = function(p) { return api('/movie/popular?page=' + p).then(function(r) { return r.results || []; }); };
var fetchTV = function(p) { return api('/tv/popular?page=' + p).then(function(r) { return r.results || []; }); };
var fetchSearch = function(q, p, signal) {
    return fetch(T + '/search/multi?query=' + encodeURIComponent(q) + '&page=' + p + '&api_key=' + TMDB_KEY + '&language=ar', { signal: signal }).then(function(r) { return r.json(); }).then(function(r) { return r.results || []; });
};
var fetchDetail = async function(t, id) {
    var data = await api('/' + t + '/' + id + '?append_to_response=credits,seasons');
    try {
        var videoData = await fetch(T + '/' + t + '/' + id + '?append_to_response=videos&api_key=' + TMDB_KEY).then(function(r) { return r.json(); });
        data.videos = videoData.videos;
    } catch(e) {}
    return data;
};

function mkCard(item) {
    var isM;
    if (item.media_type === 'tv') isM = false;
    else if (item.media_type === 'movie') isM = true;
    else isM = (item.title && !item.name);
    var title = item.title || item.name || '';
    var year = (item.release_date || item.first_air_date || '').slice(0,4);
    var rat = (item.vote_average || 0).toFixed(1);
    var poster = item.poster_path ? IMG + 'w300' + item.poster_path : '';
    var fid = String(item.id);
    var favActive = currentUser && currentFavs.some(function(f) { return f.movie_id === fid; });
    var d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = '<div class="cthumb">' + (poster ? '<img src="' + poster + '" loading="lazy">' : '') + '<div class="cov"><div class="cplay"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div><button class="cfavorite' + (favActive ? ' active' : '') + '" onclick="event.stopPropagation();toggleFav({id:\'' + fid + '\',title:\'' + title.replace(/'/g, "\\'") + '\',poster:\'' + poster + '\',type:\'' + (isM ? 'movie' : 'tv') + '\'}, this)">' + (favActive ? '❤️' : '🤍') + '</button><div class="cbadge ' + (isM ? 'bm' : 'bt') + '">' + (isM ? 'فيلم' : 'مسلسل') + '</div>' + (rat > 0 ? '<div class="crat">⭐' + rat + '</div>' : '') + '</div><div class="cinfo"><div class="cname">' + title + '</div><div class="cyear">' + year + '</div></div>';
    d.addEventListener('click', function() { openDetail(item); });
    return d;
}
function appendCards(gid, items) {
    var g = $(gid);
    if (!g || !items || !Array.isArray(items)) return;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.media_type !== 'person' && (item.poster_path || item.backdrop_path)) {
            g.appendChild(mkCard(item));
        }
    }
}

async function init() {
    if (!document.getElementById('g-mov')) return;
    await initGenres();
    await loadHero();
    try {
        var m = await fetchMov(1);
        appendCards('g-mov', m);
        var bMov = $('b-mov');
        if (bMov) bMov.style.display = 'block';
    } catch(e) {}
    try {
        var t = await fetchTV(1);
        appendCards('g-tv', t);
        var bTv = $('b-tv');
        if (bTv) bTv.style.display = 'block';
    } catch(e) {}
}

function switchTab(tab, el) {
    if ((tab === 'fav' || tab === 'hist') && !currentUser) {
        showLogin();
        return;
    }
    curTab = tab;
    var tabs = document.querySelectorAll('.ntab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('on');
    if (el) el.classList.add('on');
    hideAllSections();
    var dyn = document.querySelector('#sec-genre-dynamic');
    if (dyn) dyn.remove();
    var gbtns = document.querySelectorAll('.gbtn');
    for (var i = 0; i < gbtns.length; i++) gbtns[i].classList.remove('on');
    var firstGenre = document.querySelector('.gbtn');
    if (firstGenre) firstGenre.classList.add('on');
    if (tab === 'fav') {
        var secFav = $('sec-fav');
        if (secFav) secFav.style.display = 'block';
        renderFavorites();
    } else if (tab === 'hist') {
        var secHist = $('sec-hist');
        if (secHist) secHist.style.display = 'block';
        renderHistory();
    } else {
        var secAll = $('sec-all');
        if (secAll) secAll.style.display = 'block';
        var trendParent = $('g-trend') ? $('g-trend').parentElement : null;
        var movParent = $('g-mov') ? $('g-mov').parentElement : null;
        var tvParent = $('g-tv') ? $('g-tv').parentElement : null;
        if (trendParent) trendParent.style.display = 'block';
        if (movParent) movParent.style.display = 'block';
        if (tvParent) tvParent.style.display = 'block';
        if (tab === 'movie') {
            if (trendParent) trendParent.style.display = 'none';
            if (tvParent) tvParent.style.display = 'none';
        } else if (tab === 'tv') {
            if (trendParent) trendParent.style.display = 'none';
            if (movParent) movParent.style.display = 'none';
        }
    }
}
function renderFavorites() {
    var g = $('g-fav');
    if (!g) return;
    g.innerHTML = '';
    if (!currentFavs.length) {
        g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--t2)">فارغ</div>';
        return;
    }
    for (var i = 0; i < currentFavs.length; i++) {
        var f = currentFavs[i];
        var card = mkCard({
            id: f.movie_id,
            title: f.title,
            poster_path: f.poster ? f.poster.replace(IMG + 'w300', '') : '',
            media_type: f.type || 'movie',
            vote_average: 0
        });
        g.appendChild(card);
    }
}
function renderHistory() {
    var g = $('g-hist');
    if (!g) return;
    g.innerHTML = '';
    if (!currentHistory.length) {
        g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--t2)">فارغ</div>';
        return;
    }
    for (var i = 0; i < currentHistory.length; i++) {
        var h = currentHistory[i];
        var card = mkCard({
            id: h.movie_id,
            title: h.title,
            poster_path: h.poster ? h.poster.replace(IMG + 'w300', '') : '',
            media_type: h.type || 'movie',
            vote_average: 0
        });
        g.appendChild(card);
    }
}
async function toggleFav(item, btn) {
    if (!currentUser) { showLogin(); return; }
    try {
        var session = JSON.parse(localStorage.getItem('shush_session'));
        var token = session.access_token;
        var exists = currentFavs.find(function(f) { return f.movie_id === item.id; });
        if (exists) {
            await gatewayRequest('favorites', 'DELETE', { column: 'id', value: exists.id }, token);
            currentFavs = currentFavs.filter(function(f) { return f.id !== exists.id; });
            if (btn) { btn.classList.remove('active'); btn.textContent = '🤍'; }
            showToast('تم الإزالة');
        } else {
            var newFav = await gatewayRequest('favorites', 'POST', { user_id: currentUser.id, movie_id: item.id, title: item.title, poster: item.poster || '', type: item.type }, token);
            if (newFav && newFav.length) {
                currentFavs.push(newFav[0]);
                if (btn) { btn.classList.add('active'); btn.textContent = '❤️'; }
                showToast('❤️ أضيف لقائمتي');
            }
        }
        if (curTab === 'fav') renderFavorites();
    } catch(e) {}
}
async function addToHistory(item) {
    if (!currentUser) return;
    try {
        var session = JSON.parse(localStorage.getItem('shush_session'));
        var token = session.access_token;
        var existing = currentHistory.find(function(h) { return h.movie_id === item.id; });
        if (existing) await gatewayRequest('history', 'DELETE', { column: 'id', value: existing.id }, token);
        await gatewayRequest('history', 'POST', { user_id: currentUser.id, movie_id: item.id, title: item.title, poster: item.poster || '', type: item.type }, token);
        var hist = await gatewayRequest('history', 'GET', { columns: '*' }, token);
        currentHistory = hist || [];
        if (curTab === 'hist') renderHistory();
    } catch(e) {}
}

// ========== PROGRESS TRACKING ==========
async function saveProgressToDB(mediaId, type, season, episode, progressTime, duration) {
    if (!currentUser) return;
    try {
        await dbClient.from('watch_progress').upsert({
            user_id: currentUser.id,
            media_id: String(mediaId),
            media_type: type,
            season: season || 0,
            episode: episode || 0,
            progress_time: Math.floor(progressTime),
            duration: duration || 0,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id, media_id, media_type, season, episode' });
    } catch(e) { console.error('خطأ في حفظ التقدم', e); }
}
async function getSavedProgress(mediaId, type, season, episode) {
    if (!currentUser) return 0;
    try {
        var result = await dbClient.from('watch_progress').select('progress_time').match({
            user_id: currentUser.id,
            media_id: String(mediaId),
            media_type: type,
            season: season || 0,
            episode: episode || 0
        }).single();
        var data = result.data;
        return data ? Math.floor(data.progress_time) : 0;
    } catch(e) { return 0; }
}
function startProgressTimer() {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(function() {
        if (lastSyncTime > 0 && curItem) {
            saveProgressToDB(curItem.id, curType, curSeason, curEp, lastSyncTime, 0);
        }
    }, 5000);
}
function stopProgressTimer() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    if (lastSyncTime > 0 && curItem) { saveProgressToDB(curItem.id, curType, curSeason, curEp, lastSyncTime, 0); }
}

// ========== DETAILS & VIDEO ==========
var trailerKey = null;
async function openDetail(item) {
    curItem = item; curSeason = 1; curEp = 1; curSrc = 0;
    curType = item.media_type || (item.title && !item.name ? 'movie' : 'tv');
    var title = item.title || item.name || '';
    var year = (item.release_date || item.first_air_date || '').slice(0,4);
    var rat = (item.vote_average || 0).toFixed(1);
    var dBack = $('d-back'); if (dBack) dBack.src = '';
    var dPoster = $('d-poster'); if (dPoster) dPoster.src = '';
    var depDiv = $('dep'); if (depDiv) depDiv.style.display = 'none';
    var dSeasons = $('d-seasons'); if (dSeasons) dSeasons.innerHTML = '';
    var dEps = $('d-eps'); if (dEps) dEps.innerHTML = '';
    var dMeta = $('d-meta'); if (dMeta) dMeta.innerHTML = '';
    var dCastWrap = $('d-cast-wrap'); if (dCastWrap) dCastWrap.style.display = 'none';
    var dCast = $('d-cast'); if (dCast) dCast.innerHTML = '';
    var dov = $('dov'); if (dov) dov.classList.add('open');
    document.body.style.overflow = 'hidden';
    var dTitle = $('d-title'); if (dTitle) dTitle.textContent = title;
    var dOv = $('d-ov'); if (dOv) dOv.textContent = item.overview || 'جاري التحميل...';
    if (item.backdrop_path && dBack) dBack.src = IMG + 'w1280' + item.backdrop_path;
    if (item.poster_path && dPoster) dPoster.src = IMG + 'w500' + item.poster_path;
    var dTags = $('d-tags'); if (dTags) dTags.innerHTML = '<span class="dtag gold">⭐ ' + rat + '</span><span class="dtag">' + year + '</span><span class="dtag">' + (curType === 'movie' ? '🎬 فيلم' : '📺 مسلسل') + '</span>';
    addToHistory({ id: String(item.id), title: title, poster: item.poster_path ? IMG + 'w300' + item.poster_path : '', type: curType });
    try {
        var det = await fetchDetail(curType, item.id);
        if (!det || (!det.overview && !det.runtime && !det.number_of_seasons)) {
            var altType = curType === 'movie' ? 'tv' : 'movie';
            det = await fetchDetail(altType, item.id);
            if (det && (det.overview || det.runtime || det.number_of_seasons)) curType = altType;
        }
        curItem = Object.assign({}, item, det);
        if (det.backdrop_path && dBack) dBack.src = IMG + 'w1280' + det.backdrop_path;
        if (det.poster_path && dPoster) dPoster.src = IMG + 'w500' + det.poster_path;
        if (dOv) dOv.textContent = det.overview || item.overview || 'لا يوجد وصف';
        var genresHtml = '';
        if (det.genres) { for (var i = 0; i < det.genres.length; i++) { genresHtml += '<span class="dtag">' + det.genres[i].name + '</span>'; } }
        if (dTags) dTags.innerHTML += genresHtml;
        var trailer = (det.videos && det.videos.results) ? det.videos.results.find(function(v) { return v.type === "Trailer" && v.site === "YouTube"; }) : null;
        if (trailer) {
            trailerKey = trailer.key;
            var trailerBtn = $('trailerWatchBtn');
            if (trailerBtn) trailerBtn.classList.add('show');
        } else {
            trailerKey = null;
            var trailerBtn = $('trailerWatchBtn');
            if (trailerBtn) trailerBtn.classList.remove('show');
        }
        var metaHtml = '';
        var addRow = function(icon, label, value) { if (value) metaHtml += '<div class="dmetarow">' + icon + '<span>' + label + '</span><span>' + value + '</span></div>'; };
        addRow('⏱️', 'المدة', det.runtime ? Math.floor(det.runtime/60) + 'س ' + (det.runtime%60) + 'د' : null);
        addRow('🌍', 'البلد', (det.production_countries && det.production_countries.length) ? det.production_countries.map(function(c) { return c.name; }).join(', ') : null);
        if (curType === 'tv') {
            addRow('📺', 'الحالة', det.status);
            addRow('📑', 'المواسم', det.number_of_seasons);
            addRow('🎬', 'الحلقات', det.number_of_episodes);
        }
        if (dMeta) dMeta.innerHTML = metaHtml || '';
        if (det.credits && det.credits.cast) {
            var cast = det.credits.cast.slice(0, 8);
            if (dCast) {
                dCast.innerHTML = cast.map(function(c) {
                    var imgHtml = c.profile_path ? '<img src="' + IMG + 'w185' + c.profile_path + '">' : '<div style="width:48px;height:48px;border-radius:50%;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:16px">👤</div>';
                    return '<div class="dcast-item">' + imgHtml + '<span>' + c.name + '</span></div>';
                }).join('');
            }
            if (dCastWrap) dCastWrap.style.display = 'block';
        }
        if (curType === 'tv' && det.seasons) {
            var seasons = det.seasons.filter(function(s) { return s.season_number > 0; });
            if (seasons.length) {
                if (depDiv) depDiv.style.display = 'block';
                if (dSeasons) {
                    dSeasons.innerHTML = seasons.map(function(s, i) {
                        return '<button class="sbtn ' + (i === 0 ? 'on' : '') + '" onclick="selSeason(' + s.season_number + ',' + s.episode_count + ',this)">' + (s.name || 'الموسم ' + s.season_number) + '</button>';
                    }).join('');
                }
                renderEps(1, seasons[0].episode_count);
            }
        }
    } catch(e) { console.error(e); }
}
function selSeason(n, ec, btn) {
    curSeason = n; curEp = 1;
    var btns = document.querySelectorAll('#d-seasons .sbtn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('on');
    btn.classList.add('on');
    renderEps(n, ec);
}
function renderEps(season, total) {
    var max = Math.min(total, 100);
    var dEps = $('d-eps');
    if (dEps) {
        var html = '';
        for (var i = 1; i <= max; i++) { html += '<button class="epbtn ' + (i === 1 ? 'on' : '') + '" onclick="selEp(' + i + ',this)">ح' + i + '</button>'; }
        dEps.innerHTML = html;
    }
}
function selEp(n, btn) {
    curEp = n;
    var btns = document.querySelectorAll('#d-eps .epbtn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('on');
    btn.classList.add('on');
}
function closeDetail() {
    var dov = $('dov'); if (dov) dov.classList.remove('open');
    document.body.style.overflow = '';
}
function playTrailer() {
    if (trailerKey) {
        var trailerFrame = $('trailerFrame');
        if (trailerFrame) trailerFrame.src = 'https://www.youtube.com/embed/' + trailerKey + '?autoplay=1';
        toggleModal('trailerModal', true);
    }
}
function closeTrailer() {
    var trailerFrame = $('trailerFrame');
    if (trailerFrame) trailerFrame.src = '';
    toggleModal('trailerModal', false);
}
async function openPlayerFromDetail() {
    if (!currentUser) { showLogin(); return; }
    closeDetail();
    var title = curItem.title || curItem.name || '';
    var ptitle = $('ptitle');
    if (ptitle) ptitle.textContent = curType === 'tv' ? title + ' — م' + curSeason + ' ح' + curEp : title;
    var ppage = $('ppage'); if (ppage) ppage.classList.add('open');
    document.body.style.overflow = 'hidden';
    var srcBtns = document.querySelectorAll('.psrc');
    for (var i = 0; i < srcBtns.length; i++) srcBtns[i].classList.toggle('on', i === 0);
    curSrc = 0;
    var pepDiv = $('pep');
    if (curType === 'tv' && curItem.seasons && curItem.seasons.length) {
        if (pepDiv) pepDiv.style.display = 'block';
        buildPepRow();
    } else { if (pepDiv) pepDiv.style.display = 'none'; }
    var savedTime = await getSavedProgress(curItem.id, curType, curSeason, curEp);
    loadFrame(savedTime);
}
function buildPepRow() {
    var row = $('pep-row'); if (!row) return;
    row.innerHTML = '';
    if (!curItem.seasons) return;
    var seasons = curItem.seasons.filter(function(s) { return s.season_number > 0; });
    for (var i = 0; i < seasons.length; i++) {
        var s = seasons[i];
        var sbtn = document.createElement('button');
        sbtn.className = 'pep-sbtn' + (s.season_number === curSeason ? ' on' : '');
        sbtn.textContent = s.name || 'م ' + s.season_number;
        sbtn.onclick = (function(seasonNum, epCount) {
            return function() { pepSeason(seasonNum, epCount, this); };
        })(s.season_number, s.episode_count);
        row.appendChild(sbtn);
        if (s.season_number === curSeason) {
            var max = Math.min(s.episode_count, 100);
            for (var j = 1; j <= max; j++) {
                var ebtn = document.createElement('button');
                ebtn.className = 'pep-epbtn' + (j === curEp ? ' on' : '');
                ebtn.textContent = 'ح' + j;
                ebtn.onclick = (function(ep) { return function() { pepEp(ep, this); }; })(j);
                row.appendChild(ebtn);
            }
        }
    }
}
function pepSeason(n, ec, btn) {
    curSeason = n; curEp = 1;
    buildPepRow();
    loadFrame(0);
    var ptitle = $('ptitle');
    if (ptitle) ptitle.textContent = (curItem.title || curItem.name) + ' — م' + curSeason + ' ح' + curEp;
}
function pepEp(n, btn) {
    curEp = n;
    var btns = document.querySelectorAll('#pep-row .pep-epbtn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('on');
    if (btn) btn.classList.add('on');
    loadFrame(0);
    var ptitle = $('ptitle');
    if (ptitle) ptitle.textContent = (curItem.title || curItem.name) + ' — م' + curSeason + ' ح' + curEp;
}
function loadFrame(startTime) {
    startTime = startTime || 0;
    var pload = $('pload'); if (pload) pload.style.display = 'flex';
    var pframe = $('pframe'); if (pframe) pframe.src = '';
    setTimeout(function() {
        var url = SRCS[curSrc](curType, curItem.id, curSeason, curEp);
        if (startTime > 0 && curSrc === 0) url += (url.includes('?') ? '&' : '?') + 'startTime=' + startTime;
        if (pframe) pframe.src = url;
        if (pframe) {
            pframe.onload = function() {
                if (pframe.hasAttribute('sandbox')) pframe.removeAttribute('sandbox');
                if (pload) pload.style.display = 'none';
                startProgressTimer();
            };
        }
        setTimeout(function() { if (pload) pload.style.display = 'none'; }, 6000);
    }, 150);
}
function switchSrc(idx, btn) {
    curSrc = idx;
    var btns = document.querySelectorAll('.psrc');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('on');
    btn.classList.add('on');
    loadFrame(0);
}
function closePlayer() {
    stopProgressTimer();
    var ppage = $('ppage'); if (ppage) ppage.classList.remove('open');
    var pframe = $('pframe'); if (pframe) pframe.src = '';
    document.body.style.overflow = '';
    showAllSections();
}

// ========== SEARCH ==========
function performSearch() {
    var q = $('sinput') ? $('sinput').value.trim() : '';
    if (searchAbortController) searchAbortController.abort();
    if (q.length < 2) {
        if (originalMainHTML && $('main')) $('main').innerHTML = originalMainHTML;
        showAllSections();
        return;
    }
    searchAbortController = new AbortController();
    var signal = searchAbortController.signal;
    hideAllSections();
    var searchResults = $('search-results');
    if (searchResults) searchResults.style.display = 'block';
    var gSearch = $('g-search');
    if (gSearch) gSearch.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--t2)">جاري البحث...</div>';
    fetchSearch(q, 1, signal).then(function(res) {
        if (signal.aborted) return;
        if (gSearch) gSearch.innerHTML = '';
        if (!res.length) {
            if (gSearch) gSearch.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--t2)">لا توجد نتائج</div>';
        } else {
            for (var i = 0; i < res.length; i++) {
                var item = res[i];
                if (item.media_type !== 'person' && (item.poster_path || item.backdrop_path)) {
                    if (gSearch) gSearch.appendChild(mkCard(item));
                }
            }
        }
    }).catch(function() {});
}
if ($('sinput')) {
    $('sinput').addEventListener('input', function() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(performSearch, 600);
    });
}
if ($('searchIcon')) $('searchIcon').addEventListener('click', performSearch);

// ========== WATCH PARTY (Broadcast) with proper host ID ==========
function dismissClickPrompt() {
    var promptDiv = document.getElementById('wpClickPrompt');
    if (promptDiv) promptDiv.style.display = 'none';
}
function initBroadcast(asHost) {
    if (wpChannel) wpChannel.unsubscribe();
    const tempClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    wpChannel = tempClient.channel('room-' + wpRoomCode, { config: { broadcast: { ack: true, self: false } } });
    wpChannel.on('broadcast', { event: 'sync' }, function(payloadData) {
        var payload = payloadData.payload;
        if (!wpIsHost) {
            var command = payload.command;
            var time = payload.time;
            var frame = $('wpPlayerFrame');
            if (frame && frame.contentWindow) {
                frame.contentWindow.postMessage({ command: 'seek', time: time || 0 }, '*');
                setTimeout(function() { frame.contentWindow.postMessage({ command: command }, '*'); }, 300);
            }
        }
    });
    wpChannel.on('broadcast', { event: 'chat' }, function(payloadData) {
        var payload = payloadData.payload;
        appendChatMessage(payload.displayName, payload.message, false);
    });
    wpChannel.on('broadcast', { event: 'member_join' }, function(payloadData) {
        var payload = payloadData.payload;
        if (!wpMembers.some(function(m) { return m.userId === payload.userId; })) {
            wpMembers.push(payload);
            updateUsersListBroadcast();
        }
    });
    wpChannel.on('broadcast', { event: 'member_leave' }, function(payloadData) {
        var payload = payloadData.payload;
        wpMembers = wpMembers.filter(function(m) { return m.userId !== payload.userId; });
        updateUsersListBroadcast();
    });
    wpChannel.on('broadcast', { event: 'request_members' }, function(payloadData) {
        if (wpIsHost) {
            wpChannel.send({ type: 'broadcast', event: 'member_list', payload: { members: wpMembers, hostId: currentUser.id } });
        }
    });
    wpChannel.on('broadcast', { event: 'member_list' }, function(payloadData) {
        if (!wpIsHost) {
            var data = payloadData.payload;
            wpMembers = data.members;
            wpHostId = data.hostId;  // استلام معرف المضيف الحقيقي
            updateUsersListBroadcast();
        }
    });
    wpChannel.subscribe(async function(status) {
        if (status === 'SUBSCRIBED' && asHost) {
            wpHostId = currentUser.id;
            wpChannel.send({ type: 'broadcast', event: 'member_join', payload: { userId: currentUser.id, displayName: (currentUser.user_metadata && currentUser.user_metadata.display_name) ? currentUser.user_metadata.display_name : 'المضيف', avatar: (currentUser.user_metadata && currentUser.user_metadata.avatar) ? currentUser.user_metadata.avatar : '👑' } });
            if (!wpMembers.some(function(m) { return m.userId === currentUser.id; })) {
                wpMembers.push({ userId: currentUser.id, displayName: (currentUser.user_metadata && currentUser.user_metadata.display_name) ? currentUser.user_metadata.display_name : 'المضيف', avatar: (currentUser.user_metadata && currentUser.user_metadata.avatar) ? currentUser.user_metadata.avatar : '👑' });
                updateUsersListBroadcast();
            }
        } else if (status === 'SUBSCRIBED' && !asHost) {
            setTimeout(function() {
                if (wpChannel) wpChannel.send({ type: 'broadcast', event: 'request_members', payload: {} });
            }, 500);
        }
    });
}
function sendSyncCommand(command, time) {
    if (!wpIsHost || !wpChannel) return;
    wpChannel.send({ type: 'broadcast', event: 'sync', payload: { command: command, time: time } });
}
function sendChatMessageBroadcast(msg) {
    if (!wpChannel) return;
    var displayName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.display_name) ? currentUser.user_metadata.display_name : 'مجهول';
    wpChannel.send({ type: 'broadcast', event: 'chat', payload: { displayName: displayName, message: msg } });
}
function handlePlayerMessage(event) {
    if (!VIDFAST_ORIGINS.includes(event.origin)) return;
    if (!event.data || event.data.type !== 'PLAYER_EVENT') return;
    var e = event.data.data.event;
    var currentTime = event.data.data.currentTime;
    var playing = event.data.data.playing;
    if (wpIsHost && wpChannel) {
        if (e === 'play' || e === 'playing') sendSyncCommand('play', currentTime);
        else if (e === 'pause') sendSyncCommand('pause', currentTime);
        else if (e === 'seeked') sendSyncCommand(playing ? 'play' : 'pause', currentTime);
        if (currentTime !== undefined) lastSyncTime = currentTime;
    }
}
async function createWatchParty() {
    if (!currentUser) { showLogin(); return; }
    closeDetail();
    wpRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    wpIsHost = true;
    wpHostId = currentUser.id;
    var session = JSON.parse(localStorage.getItem('shush_session'));
    var token = session.access_token;
    try {
        await gatewayRequest('rooms', 'POST', { host_id: currentUser.id, movie_id: String(curItem.id), movie_title: curItem.title || curItem.name, movie_poster: curItem.poster_path ? IMG + 'w300' + curItem.poster_path : '', media_type: curType, season: curSeason, episode: curEp, room_code: wpRoomCode, is_active: true }, token);
    } catch(e) {}
    openWatchPartyUI();
    initBroadcast(true);
}
async function joinWatchParty(code) {
    if (!currentUser) {
        pendingRoomCode = code;
        showLogin();
        return;
    }
    showJoinSplash('🎉 جاري الانضمام...');
    wpRoomCode = code;
    wpIsHost = false;
    var session = JSON.parse(localStorage.getItem('shush_session'));
    var token = session.access_token;
    try {
        var roomsResult = await gatewayRequest('rooms', 'GET', { room_code: code }, token);
        var rooms = roomsResult;
        if (rooms && rooms.length > 0 && rooms[0].is_active !== false) {
            var r = rooms[0];
            curItem = { id: r.movie_id, title: r.movie_title, poster_path: r.movie_poster ? r.movie_poster.replace(IMG + 'w300', '') : '', media_type: r.media_type };
            curType = r.media_type;
            curSeason = r.season;
            curEp = r.episode;
            hideJoinSplash();
            openWatchPartyUI();
            initBroadcast(false);
            setTimeout(function() {
                if (wpChannel) {
                    wpChannel.send({ type: 'broadcast', event: 'member_join', payload: { userId: currentUser.id, displayName: (currentUser.user_metadata && currentUser.user_metadata.display_name) ? currentUser.user_metadata.display_name : 'ضيف', avatar: (currentUser.user_metadata && currentUser.user_metadata.avatar) ? currentUser.user_metadata.avatar : '👤' } });
                }
            }, 1000);
            // حذف إشعارات الدعوة لهذه الغرفة
            await dbClient.from('notifications').delete().eq('user_id', currentUser.id).eq('type', 'room_invite').eq('data->>roomCode', code);
            loadNotifications();
        } else { showJoinError('❌ الغرفة غير متاحة'); }
    } catch(e) { showJoinError('❌ فشل الانضمام'); }
}
function openWatchPartyUI() {
    toggleModal('watchPartyModal', true);
    document.body.style.overflow = 'hidden';
    var placeholder = $('wpPlayerPlaceholder');
    if (placeholder) placeholder.style.display = 'none';
    var wpPlayerFrame = $('wpPlayerFrame');
    if (wpPlayerFrame) {
        wpPlayerFrame.style.display = 'block';
        wpPlayerFrame.src = SRCS[0](curType, curItem.id, curSeason, curEp);
        wpPlayerFrame.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
        wpPlayerFrame.onload = function() {
            if (wpPlayerFrame.hasAttribute('sandbox')) wpPlayerFrame.removeAttribute('sandbox');
        };
    }
    var wpChat = $('wpChat'); if (wpChat) wpChat.innerHTML = '';
    var wpEndBtn = $('wpEndBtn'); if (wpEndBtn) wpEndBtn.style.display = wpIsHost ? 'flex' : 'none';
    wpMembers = [];
    wpMembers.push({ userId: currentUser.id, displayName: (currentUser.user_metadata && currentUser.user_metadata.display_name) ? currentUser.user_metadata.display_name : (currentUser.email ? currentUser.email.split('@')[0] : 'مستخدم'), avatar: (currentUser.user_metadata && currentUser.user_metadata.avatar) ? currentUser.user_metadata.avatar : '😊' });
    updateUsersListBroadcast();
    if (wpIsHost) {
        window.addEventListener('message', handlePlayerMessage);
    }
}
function updateUsersListBroadcast() {
    const usersList = $('wpUsersList');
    usersList.querySelectorAll('.wp-user-item').forEach(el => el.remove());
    const myName = currentUser?.user_metadata?.display_name || 'أنا';
    const myAvatar = currentUser?.user_metadata?.avatar || '😊';
    const myIcon = avatarToIcon(myAvatar);
    const myDiv = document.createElement('div');
    myDiv.className = 'wp-user-item';
    myDiv.innerHTML = `<div class="user-name"><span class="user-dot"></span><span>${myIcon}</span><span>${myName}</span>${wpIsHost ? '<span class="host-badge">المضيف</span>' : ''}</div>`;
    usersList.appendChild(myDiv);
    wpMembers.forEach(m => {
        if (m.userId !== currentUser?.id) {
            const userIcon = avatarToIcon(m.avatar || '👤');
            const userDiv = document.createElement('div');
            userDiv.className = 'wp-user-item';
            userDiv.innerHTML = `<div class="user-name"><span class="user-dot"></span><span>${userIcon}</span><span>${m.displayName}</span></div>`;
            usersList.appendChild(userDiv);
        }
    });
}
// أضف هذه الدالة المساعدة:
function avatarToIcon(emoji) {
    const map = {
        '😊': '<i class="fa-regular fa-face-smile"></i>',
        '👨': '<i class="fa-solid fa-user-tie"></i>',
        '👩': '<i class="fa-solid fa-user"></i>',
        '👦': '<i class="fa-solid fa-child"></i>',
        '👧': '<i class="fa-solid fa-child"></i>',
        '🦸‍♂️': '<i class="fa-solid fa-mask"></i>',
        '🦸‍♀️': '<i class="fa-solid fa-mask"></i>',
        '🥷': '<i class="fa-solid fa-user-ninja"></i>',
        '🧛‍♂️': '<i class="fa-solid fa-vampire"></i>',
        '🧚‍♀️': '<i class="fa-solid fa-fairy"></i>',
        '🕵️‍♂️': '<i class="fa-solid fa-user-secret"></i>',
        '🧑‍🚀': '<i class="fa-solid fa-astronaut"></i>',
        '🦁': '<i class="fa-solid fa-lion"></i>',
        '🐼': '<i class="fa-solid fa-panda"></i>',
        '🦊': '<i class="fa-solid fa-fox"></i>',
        '🦉': '<i class="fa-solid fa-owl"></i>',
        '👑': '<i class="fa-solid fa-crown"></i>',
        '👤': '<i class="fa-regular fa-circle-user"></i>'
    };
    return map[emoji] || '<i class="fa-regular fa-circle-user"></i>';
}
function appendChatMessage(name, msg, isMe) {
    const chat = $('wpChat');
    if (!chat) return;
    const div = document.createElement('div');
    div.className = 'wp-chat-msg';
    const avatarIcon = isMe ? (currentUser?.user_metadata?.avatar || '😊') : '👤';
    const iconHtml = avatarToIcon(avatarIcon);
    div.innerHTML = `<div class="avatar">${iconHtml}</div><div class="content"><div class="name">${name}</div>${msg}</div>`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}
function sendChatMessage() {
    var input = $('wpMessageInput'); if (!input) return;
    var msg = input.value.trim(); if (!msg) return;
    var displayName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.display_name) ? currentUser.user_metadata.display_name : 'مجهول';
    appendChatMessage(displayName, msg, true);
    sendChatMessageBroadcast(msg);
    input.value = '';
}
function closeWatchParty() {
    toggleModal('watchPartyModal', false);
    document.body.style.overflow = '';
    var wpPlayerFrame = $('wpPlayerFrame'); if (wpPlayerFrame) wpPlayerFrame.src = '';
    if (wpChannel) {
        if (wpIsHost && wpMembers.length) {
            wpChannel.send({ type: 'broadcast', event: 'member_leave', payload: { userId: currentUser.id } });
        }
        wpChannel.unsubscribe();
        wpChannel = null;
    }
    // إذا كان المضيف وهو آخر عضو (أو غادر الجميع) نغلق الغرفة في قاعدة البيانات
    if (wpIsHost && wpMembers.length <= 1) {
        (async () => {
            try {
                var session = JSON.parse(localStorage.getItem('shush_session'));
                var token = session.access_token;
                await gatewayRequest('rooms', 'PUT', { id: wpRoomCode, is_active: false }, token);
                console.log('تم حذف الغرفة بسبب مغادرة المضيف');
            } catch(e) { console.error(e); }
        })();
    }
    wpRoomCode = null;
    wpIsHost = false;
    wpHostId = null;
    wpMembers = [];
    window.removeEventListener('message', handlePlayerMessage);
}
async function endWatchParty() {
    if (!wpIsHost) return;
    if (confirm('إنهاء الغرفة؟')) {
        try {
            var session = JSON.parse(localStorage.getItem('shush_session'));
            var token = session.access_token;
            await gatewayRequest('rooms', 'PUT', { id: wpRoomCode, is_active: false }, token);
        } catch(e) {}
        showToast('تم إنهاء الغرفة');
        closeWatchParty();
    }
}
function inviteFriendsToRoom() {
    if (friends.length === 0) { showToast('لا يوجد أصدقاء'); return; }
    var list = $('inviteFriendsList');
    if (list) {
        list.innerHTML = friends.map(function(f) {
            return '<div class="friend-item"><div class="finfo"><div class="favatar">' + (f.avatar || '👤') + '</div><span>' + f.display_name + '</span></div><button class="login-btn" style="width:auto;padding:6px 12px;font-size:11px;" onclick="sendRoomInvite(\'' + f.id + '\')">دعوة</button></div>';
        }).join('');
    }
    toggleModal('inviteFriendsModal', true);
}
async function sendRoomInvite(friendId) {
    try {
        var result = await dbClient.from('notifications').insert({ user_id: friendId, type: 'room_invite', sender_id: currentUser.id, message: 'يدعوك لمشاهدة عمل معاً', data: { roomCode: wpRoomCode } });
        if (result.error) throw result.error;
        showToast('✅ تم إرسال الدعوة');
        closeInviteModal();
    } catch(e) { console.error(e); showToast('❌ فشل الإرسال'); }
}
function showJoinSplash(text) {
    var splash = $('joinSplash');
    if (splash) {
        var splashText = $('joinSplashText');
        if (splashText) splashText.textContent = text;
        var splashError = $('joinSplashError'); if (splashError) splashError.style.display = 'none';
        var splashRetry = $('joinSplashRetry'); if (splashRetry) splashRetry.style.display = 'none';
        splash.classList.add('active');
    }
}
function showJoinError(msg) {
    var splash = $('joinSplash');
    if (splash) {
        var splashText = $('joinSplashText'); if (splashText) splashText.textContent = '';
        var splashError = $('joinSplashError'); if (splashError) { splashError.textContent = msg; splashError.style.display = 'block'; }
        var splashRetry = $('joinSplashRetry'); if (splashRetry) splashRetry.style.display = 'block';
    }
}
function hideJoinSplash() {
    var splash = $('joinSplash');
    if (splash) splash.classList.remove('active');
}
function retryJoinRoom() {
    var code = pendingRoomCode || new URLSearchParams(window.location.search).get('room');
    if (code) { showJoinSplash('🎉 جاري الانضمام...'); joinWatchParty(code); }
}
function copyInviteLink() {
    var url = window.location.origin + window.location.pathname + '?room=' + wpRoomCode;
    navigator.clipboard.writeText(url).then(function() { showToast('📋 تم النسخ'); });
}

// ========== MISC & INIT ==========
async function checkSession() {
    var saved = localStorage.getItem('shush_session');
    if (saved) {
        try {
            var session = JSON.parse(saved);
            var result = await authGateway('getSession', { sessionToken: session.access_token });
            var data = result.data;
            if (data && data.user) {
                currentUser = data.user;
                await loadUserData();
                updateUIAfterLogin();
            }
        } catch(e) {}
    }
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        if ($('ppage') && $('ppage').classList.contains('open')) closePlayer();
        else if ($('dov') && $('dov').classList.contains('open')) closeDetail();
        else if ($('trailerModal') && $('trailerModal').classList.contains('active')) closeTrailer();
        else if ($('watchPartyModal') && $('watchPartyModal').classList.contains('active')) closeWatchParty();
        else if ($('loginModal') && $('loginModal').classList.contains('active')) closeLoginModal();
        else if ($('settingsModal') && $('settingsModal').classList.contains('active')) closeSettings();
        else if ($('friendsModal') && $('friendsModal').classList.contains('active')) closeFriends();
        else if ($('adminModal') && $('adminModal').classList.contains('active')) closeAdmin();
        else if ($('recommendModal') && $('recommendModal').classList.contains('active')) closeRecommendModal();
        else if ($('dmModal') && $('dmModal').classList.contains('active')) closeDMModal();
        else if ($('notificationsModal') && $('notificationsModal').classList.contains('active')) closeNotifications();
      
    }
});
document.addEventListener('click', function(e) {
    const userInfo = document.getElementById('userInfo');
    const dropdown = document.getElementById('userDropdown');
    if (userInfo && dropdown && !userInfo.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});
if ($('wpMessageInput')) {
    $('wpMessageInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') sendChatMessage();
    });
}

(async function() {
    var splash = document.getElementById('splash-screen');
    var minSplashTime = new Promise(function(resolve) { setTimeout(resolve, 700); });
    try {
        await Promise.all([init(), checkSession(), minSplashTime]);
        var urlParams = new URLSearchParams(window.location.search);
        var code = urlParams.get('room');
        if (code) {
            if (!currentUser) {
                pendingRoomCode = code;
                showLogin();
            } else {
                showJoinSplash('🎉 جاري الانضمام...');
                await joinWatchParty(code);
            }
        }
        var mainEl = $('main');
        if (mainEl) originalMainHTML = mainEl.innerHTML;
    } catch(e) { console.error(e); } finally {
        if (splash) {
            splash.classList.add('fade-out');
            setTimeout(function() { if (splash && splash.remove) splash.remove(); }, 300);
        }
    }
})();
