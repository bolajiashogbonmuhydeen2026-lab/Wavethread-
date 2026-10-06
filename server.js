const socket = io();
let currentUser = { name: '', phone: '' };
let activeRoomId = null;
let replyTargetMessage = null;
let mediaRecorder = null;
let audioChunks = [];
let savedPrivateChats = new Set();

// Authentication
document.getElementById('login-btn').addEventListener('click', () => {
  const name = document.getElementById('user-name').value.trim();
  const phone = document.getElementById('user-phone').value.trim();
  if (!name || !phone) return alert('Please enter both name and phone number.');
  
  currentUser = { name, phone };
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('main-screen').style.display = 'flex';
  document.getElementById('status-avatar-my').textContent = name.charAt(0).toUpperCase();
  
  fetchStatuses();
});

// Theme Toggle
document.getElementById('theme-btn').addEventListener('click', () => {
  document.body.classList.toggle('light-theme');
});

// Navigation Tabs
const tabChats = document.getElementById('tab-chats');
const tabStatus = document.getElementById('tab-status');

tabChats.addEventListener('click', () => {
  tabChats.classList.add('active'); 
  tabStatus.classList.remove('active');
  document.getElementById('chats-panel').classList.add('active');
  document.getElementById('status-panel').classList.remove('active');
});

tabStatus.addEventListener('click', () => {
  tabStatus.classList.add('active'); 
  tabChats.classList.remove('active');
  document.getElementById('status-panel').classList.add('active');
  document.getElementById('chats-panel').classList.remove('active');
  fetchStatuses();
});

// Private DM Setup
document.getElementById('start-dm-btn').addEventListener('click', () => {
  const targetPhone = document.getElementById('dm-phone-input').value.trim();
  if (!targetPhone) return alert('Please enter a target phone number.');
  if (targetPhone === currentUser.phone) return alert('You cannot DM your own number.');

  const roomId = [currentUser.phone, targetPhone].sort().join('_');
  addPrivateChatToSidebar(roomId, targetPhone);
  openChat(roomId, `DM: ${targetPhone}`);
  document.getElementById('dm-phone-input').value = '';
});

function addPrivateChatToSidebar(roomId, label) {
  if (savedPrivateChats.has(roomId)) return;
  savedPrivateChats.add(roomId);

  const list = document.getElementById('private-chats-list');
  const item = document.createElement('div');
  item.className = 'chat-list-item';
  item.onclick = () => openChat(roomId, `DM: ${label}`);
  item.innerHTML = `
    <div class="chat-avatar">${label.charAt(0).toUpperCase()}</div>
    <div class="chat-info">
      <h4>${escapeHtml(label)}</h4>
      <p>Private Chat Room</p>
    </div>
  `;
  list.prepend(item);
}

function openChat(roomId, displayName) {
  activeRoomId = roomId;
  document.getElementById('active-chat-view').style.display = 'flex';
  document.getElementById('active-chat-name').textContent = displayName;
  document.getElementById('active-avatar').textContent = displayName.replace('DM: ', '').charAt(0).toUpperCase();
  socket.emit('join_room', roomId);
}

document.getElementById('close-chat-btn').addEventListener('click', () => {
  document.getElementById('active-chat-view').style.display = 'none';
  activeRoomId = null;
});

// Socket Event Listeners
socket.on('load_messages', (messages) => {
  const container = document.getElementById('messages-container');
  container.innerHTML = '';
  messages.forEach(renderMessage);
  scrollToBottom();
});

socket.on('receive_message', (data) => {
  if (data.roomId === activeRoomId) {
    renderMessage(data);
    scrollToBottom();
  }
});

socket.on('message_edited', (data) => {
  const msgElem = document.getElementById(`msg-text-${data.id}`);
  if (msgElem) msgElem.textContent = `${data.newMessage} (edited)`;
});

socket.on('new_status', (status) => {
  renderStatusItem(status, true);
});

socket.on('status_view_updated', (data) => {
  const badge = document.getElementById(`status-view-count-${data.statusId}`);
  if (badge) badge.textContent = `👁️ ${data.viewCount}`;
});

// Messaging Functions
function sendMessage(fileUrl = null, fileType = null) {
  const text = document.getElementById('message-input').value.trim();
  if ((text || fileUrl) && activeRoomId) {
    socket.emit('send_message', {
      roomId: activeRoomId,
      sender: currentUser.name,
      phone: currentUser.phone,
      message: text,
      fileUrl: fileUrl,
      fileType: fileType,
      replyTo: replyTargetMessage
    });
    document.getElementById('message-input').value = '';
    cancelReply();
  }
}

document.getElementById('send-btn').addEventListener('click', () => sendMessage());
document.getElementById('message-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// Attachment Handler
const attachBtn = document.getElementById('attach-btn');
const mediaFileInput = document.getElementById('media-file-input');

attachBtn.addEventListener('click', () => mediaFileInput.click());
mediaFileInput.addEventListener('change', async () => {
  const file = mediaFileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.fileUrl) sendMessage(data.fileUrl, data.fileType);
  } catch (err) {
    alert('File upload failed.');
  }
  mediaFileInput.value = '';
});

// Voice Note Recorder Handler
const micBtn = document.getElementById('mic-btn');
micBtn.addEventListener('click', async () => {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', audioBlob, 'voicenote.webm');

        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.fileUrl) sendMessage(data.fileUrl, 'audio/webm');
      };

      mediaRecorder.start();
      micBtn.classList.add('recording');
    } catch (err) {
      alert('Microphone access denied or unavailable.');
    }
  } else {
    mediaRecorder.stop();
    micBtn.classList.remove('recording');
  }
});

// Render Message
function renderMessage(data) {
  const container = document.getElementById('messages-container');
  const isSent = data.sender === currentUser.name;
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
  
  let replyHtml = data.replyTo ? `<div class="reply-quote">${escapeHtml(data.replyTo)}</div>` : '';
  let mediaHtml = '';

  if (data.fileUrl) {
    if (data.fileType && data.fileType.startsWith('image')) {
      mediaHtml = `<img src="${data.fileUrl}" class="media-element"/>`;
    } else if (data.fileType && data.fileType.startsWith('video')) {
      mediaHtml = `<video src="${data.fileUrl}" controls class="media-element"></video>`;
    } else if (data.fileType && data.fileType.startsWith('audio')) {
      mediaHtml = `<audio src="${data.fileUrl}" controls style="margin-top:6px; width:100%;"></audio>`;
    }
  }

  const canEdit = isSent && data.message;

  bubble.innerHTML = `
    ${replyHtml}
    <div style="font-size:0.72rem; font-weight:bold; color:var(--accent); margin-bottom:2px;">${isSent ? 'You' : escapeHtml(data.sender)}</div>
    ${data.message ? `<div id="msg-text-${data.id}">${escapeHtml(data.message)}</div>` : ''}
    ${mediaHtml}
    <div class="msg-time">${new Date(data.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
    ${canEdit ? `<button class="edit-btn" onclick="editMsg(${data.id}, '${escapeHtml(data.message)}')">✏️</button>` : ''}
  `;

  let touchStartX = 0;
  bubble.addEventListener('touchstart', e => touchStartX = e.touches[0].clientX);
  bubble.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientX - touchStartX > 50) {
      setReply(data.message || 'Media Content');
    }
  });

  container.appendChild(bubble);
}

function setReply(text) {
  replyTargetMessage = text;
  document.getElementById('reply-preview-text').textContent = `Replying to: ${text}`;
  document.getElementById('reply-preview-bar').style.display = 'flex';
}

function cancelReply() {
  replyTargetMessage = null;
  document.getElementById('reply-preview-bar').style.display = 'none';
}

function editMsg(id, oldText) {
  const newText = prompt('Edit your message:', oldText);
  if (newText && newText !== oldText) {
    socket.emit('edit_message', { id, roomId: activeRoomId, newMessage: newText });
  }
}

// Status System & Viewer Engine
const postStatusBtn = document.getElementById('post-status-btn');
const statusFileInput = document.getElementById('status-file-input');

postStatusBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  statusFileInput.click();
});

statusFileInput.addEventListener('change', async () => {
  const file = statusFileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('phone', currentUser.phone);
  formData.append('userName', currentUser.name);

  try {
    await fetch('/api/status', { method: 'POST', body: formData });
    fetchStatuses();
  } catch (err) {
    alert('Status post failed.');
  }
  statusFileInput.value = '';
});

async function fetchStatuses() {
  try {
    const res = await fetch('/api/statuses');
    const statuses = await res.json();
    const feed = document.getElementById('status-feed-list');
    feed.innerHTML = '';
    statuses.forEach(status => renderStatusItem(status, false));
  } catch (err) {
    console.error('Failed to load statuses', err);
  }
}

async function renderStatusItem(status, prepend = false) {
  const feed = document.getElementById('status-feed-list');
  const item = document.createElement('div');
  item.className = 'status-card';
  item.onclick = () => openStatusViewer(status);

  let mediaElement = status.fileType.startsWith('video') 
    ? `<video src="${status.fileUrl}" class="status-thumb"></video>`
    : `<img src="${status.fileUrl}" class="status-thumb"/>`;

  const viewRes = await fetch(`/api/status/${status.id}/views`);
  const viewData = await viewRes.json();

  item.innerHTML = `
    <div class="status-media-container">${mediaElement}</div>
    <div class="chat-info">
      <h4>${escapeHtml(status.userName)} ${status.phone === currentUser.phone ? '(You)' : ''}</h4>
      <p>${new Date(status.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
      <div class="view-count-badge" id="status-view-count-${status.id}">👁️ ${viewData.viewCount || 0}</div>
    </div>
  `;

  if (prepend) feed.prepend(item);
  else feed.appendChild(item);
}

async function openStatusViewer(status) {
  const modal = document.getElementById('status-viewer-modal');
  const holder = document.getElementById('status-media-holder');
  const userText = document.getElementById('status-viewer-user');
  const viewText = document.getElementById('status-viewer-views');

  userText.textContent = `${status.userName}'s Status`;
  holder.innerHTML = status.fileType.startsWith('video')
    ? `<video src="${status.fileUrl}" controls autoPlay id="status-viewer-media"></video>`
    : `<img src="${status.fileUrl}" id="status-viewer-media"/>`;

  modal.style.display = 'flex';

  // Register View Event
  try {
    const res = await fetch('/api/status/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusId: status.id, viewerPhone: currentUser.phone })
    });
    const data = await res.json();
    viewText.textContent = `👁️ ${data.viewCount} views`;
  } catch (err) {
    console.error('Failed to update views', err);
  }
}

function closeStatusViewer() {
  const modal = document.getElementById('status-viewer-modal');
  const holder = document.getElementById('status-media-holder');
  holder.innerHTML = '';
  modal.style.display = 'none';
}

function scrollToBottom() {
  const container = document.getElementById('messages-container');
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  return text ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : '';
}
  
