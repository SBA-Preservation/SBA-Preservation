(function () {
  'use strict';

  var auth = firebase.auth();
  var db = firebase.firestore();

  var currentUser = null;
  var editingEventId = null;
  var confirmCallback = null;

  // ===================== DOM REFS =====================

  var $ = function (id) { return document.getElementById(id); };

  var loadingOverlay = $('loading-overlay');
  var loginPage = $('login-page');
  var forgotPage = $('forgot-page');
  var setupPage = $('setup-page');
  var dashboard = $('dashboard');

  // ===================== UI HELPERS =====================

  function showPage(page) {
    [loginPage, forgotPage, setupPage, dashboard].forEach(function (p) {
      p.classList.add('hidden');
    });
    page.classList.remove('hidden');
    loadingOverlay.classList.add('hidden');
  }

  function showToast(message, type) {
    var toast = $('toast');
    toast.textContent = message;
    toast.className = 'toast ' + (type || 'info');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { toast.className = 'toast hidden'; }, 4000);
  }

  function showConfirm(title, message, onConfirm) {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-dialog').classList.remove('hidden');
    confirmCallback = onConfirm;
  }

  function hideConfirm() {
    $('confirm-dialog').classList.remove('hidden');
    $('confirm-dialog').classList.add('hidden');
    confirmCallback = null;
  }

  function setButtonLoading(btn, loading, originalText) {
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = 'Please wait...';
    } else {
      btn.disabled = false;
      btn.textContent = originalText || btn.dataset.originalText || 'Submit';
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function getEventDisplayStatus(evt) {
    var today = todayStr();
    if (evt.status === 'draft') return 'draft';
    if (today < evt.displayStartDate) return 'scheduled';
    if (today > evt.displayEndDate) return 'expired';
    return 'published';
  }

  // ===================== AUTH =====================

  auth.onAuthStateChanged(function (user) {
    if (user) {
      db.collection('admins').doc(user.uid).get().then(function (doc) {
        if (doc.exists) {
          currentUser = user;
          $('user-email').textContent = user.email;
          showPage(dashboard);
          loadEvents();
          loadUsers();
          loadAuditLog();
        } else {
          auth.signOut();
          showToast('You are not authorized as an administrator.', 'error');
          showPage(loginPage);
        }
      });
    } else {
      db.collection('settings').doc('setup').get().then(function (doc) {
        if (doc.exists) {
          showPage(loginPage);
        } else {
          showPage(setupPage);
        }
      }).catch(function () {
        showPage(loginPage);
      });
    }
  });

  // Login
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = this.querySelector('button[type="submit"]');
    setButtonLoading(btn, true);
    auth.signInWithEmailAndPassword(
      $('login-email').value.trim(),
      $('login-password').value
    ).then(function () {
      setButtonLoading(btn, false, 'Sign In');
    }).catch(function (err) {
      setButtonLoading(btn, false, 'Sign In');
      showToast(err.message, 'error');
    });
  });

  // Forgot password
  $('forgot-link').addEventListener('click', function (e) {
    e.preventDefault();
    showPage(forgotPage);
  });

  $('back-to-login').addEventListener('click', function (e) {
    e.preventDefault();
    showPage(loginPage);
  });

  $('forgot-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = this.querySelector('button[type="submit"]');
    setButtonLoading(btn, true);
    auth.sendPasswordResetEmail($('forgot-email').value.trim()).then(function () {
      setButtonLoading(btn, false, 'Send Reset Link');
      showToast('Password reset email sent! Check your inbox.', 'success');
      showPage(loginPage);
    }).catch(function (err) {
      setButtonLoading(btn, false, 'Send Reset Link');
      showToast(err.message, 'error');
    });
  });

  // Initial setup
  $('setup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('setup-name').value.trim();
    var email = $('setup-email').value.trim();
    var password = $('setup-password').value;
    var confirm = $('setup-confirm').value;

    if (password !== confirm) {
      showToast('Passwords do not match.', 'error');
      return;
    }

    var btn = this.querySelector('button[type="submit"]');
    setButtonLoading(btn, true);

    auth.createUserWithEmailAndPassword(email, password).then(function (cred) {
      return cred.user.updateProfile({ displayName: name }).then(function () {
        return db.collection('admins').doc(cred.user.uid).set({
          name: name,
          email: email,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }).then(function () {
        return db.collection('settings').doc('setup').set({
          completedAt: firebase.firestore.FieldValue.serverTimestamp(),
          completedBy: cred.user.uid
        });
      }).then(function () {
        return addAuditEntry('setup', 'Initial admin account created', { email: email });
      });
    }).then(function () {
      setButtonLoading(btn, false, 'Create Admin Account');
      showToast('Admin account created successfully!', 'success');
    }).catch(function (err) {
      setButtonLoading(btn, false, 'Create Admin Account');
      showToast(err.message, 'error');
    });
  });

  // Logout
  $('logout-btn').addEventListener('click', function () {
    auth.signOut();
  });

  // Change password
  $('change-password-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var currentPw = $('current-password').value;
    var newPw = $('new-password').value;
    var confirmPw = $('confirm-new-password').value;

    if (newPw !== confirmPw) {
      showToast('New passwords do not match.', 'error');
      return;
    }

    var btn = this.querySelector('button[type="submit"]');
    setButtonLoading(btn, true);

    var credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, currentPw);
    currentUser.reauthenticateWithCredential(credential).then(function () {
      return currentUser.updatePassword(newPw);
    }).then(function () {
      setButtonLoading(btn, false, 'Update Password');
      showToast('Password updated successfully!', 'success');
      $('change-password-form').reset();
    }).catch(function (err) {
      setButtonLoading(btn, false, 'Update Password');
      showToast(err.message, 'error');
    });
  });

  // ===================== TAB NAVIGATION =====================

  document.querySelectorAll('.nav-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.nav-tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
      tab.classList.add('active');
      $(tab.dataset.tab).classList.add('active');
    });
  });

  // ===================== EVENTS CRUD =====================

  function loadEvents() {
    db.collection('events').orderBy('eventDate', 'desc').get().then(function (snapshot) {
      var container = $('events-list');
      if (snapshot.empty) {
        container.innerHTML = '<p class="empty-state">No events yet. Click "Add Event" to create one.</p>';
        return;
      }
      container.innerHTML = '';
      snapshot.forEach(function (doc) {
        var evt = doc.data();
        evt.id = doc.id;
        container.appendChild(createEventCard(evt));
      });
    });
  }

  function createEventCard(evt) {
    var card = document.createElement('div');
    card.className = 'admin-event-card';

    var displayStatus = getEventDisplayStatus(evt);

    var thumbHtml;
    if (evt.imageUrl) {
      thumbHtml = '<img src="' + evt.imageUrl + '" alt="" class="admin-event-thumb">';
    } else {
      thumbHtml = '<div class="admin-event-thumb-placeholder">No image</div>';
    }

    card.innerHTML = thumbHtml +
      '<div class="admin-event-info">' +
        '<h4>' + escapeHtml(evt.title) + '</h4>' +
        '<div class="admin-event-meta">' +
          '<span class="status-badge ' + displayStatus + '">' + displayStatus + '</span>' +
          '<span>' + formatDate(evt.eventDate) + '</span>' +
          '<span>Show: ' + formatDate(evt.displayStartDate) + ' – ' + formatDate(evt.displayEndDate) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="admin-event-actions">' +
        '<button class="action-btn preview-btn">Preview</button>' +
        '<button class="action-btn edit-btn">Edit</button>' +
        '<button class="action-btn delete delete-btn">Delete</button>' +
      '</div>';

    card.querySelector('.preview-btn').addEventListener('click', function () {
      showEventPreview(evt);
    });
    card.querySelector('.edit-btn').addEventListener('click', function () {
      openEventForm(evt);
    });
    card.querySelector('.delete-btn').addEventListener('click', function () {
      showConfirm('Delete Event', 'Are you sure you want to delete "' + evt.title + '"? This cannot be undone.', function () {
        deleteEvent(evt);
      });
    });

    return card;
  }

  function openEventForm(evt) {
    editingEventId = evt ? evt.id : null;

    $('event-modal-title').textContent = evt ? 'Edit Event' : 'Add Event';
    $('evt-title').value = evt ? evt.title : '';
    $('evt-tagline').value = evt ? evt.tagline || '' : '';
    $('evt-description').value = evt ? evt.description || '' : '';
    $('evt-date').value = evt ? evt.eventDate || '' : '';
    $('evt-time').value = evt ? evt.eventTime || '' : '';
    $('evt-location').value = evt ? evt.location || '' : '';
    $('evt-cost').value = evt ? evt.cost || '' : '';
    $('evt-link-url').value = evt ? evt.externalLinkUrl || '' : '';
    $('evt-link-text').value = evt ? evt.externalLinkText || 'Event Details' : 'Event Details';
    $('evt-display-start').value = evt ? evt.displayStartDate || '' : todayStr();
    $('evt-display-end').value = evt ? evt.displayEndDate || '' : '';
    $('evt-image-url').value = evt ? evt.imageUrl || '' : '';

    var statusRadios = document.querySelectorAll('input[name="evt-status"]');
    statusRadios.forEach(function (r) {
      r.checked = r.value === (evt ? evt.status : 'published');
    });

    // Image preview
    updateImagePreview();

    // Highlights
    var container = $('highlights-container');
    container.innerHTML = '';
    if (evt && evt.highlights && evt.highlights.length > 0) {
      evt.highlights.forEach(function (h) {
        addHighlightRow(h.name, h.description);
      });
    }

    $('event-modal').classList.remove('hidden');
  }

  function closeEventForm() {
    $('event-modal').classList.add('hidden');
    $('event-form').reset();
    editingEventId = null;
  }

  function collectFormData() {
    var highlights = [];
    document.querySelectorAll('.highlight-row').forEach(function (row) {
      var name = row.querySelector('.hl-name').value.trim();
      var desc = row.querySelector('.hl-desc').value.trim();
      if (name || desc) highlights.push({ name: name, description: desc });
    });

    var status = 'published';
    document.querySelectorAll('input[name="evt-status"]').forEach(function (r) {
      if (r.checked) status = r.value;
    });

    return {
      title: $('evt-title').value.trim(),
      tagline: $('evt-tagline').value.trim(),
      description: $('evt-description').value.trim(),
      eventDate: $('evt-date').value,
      eventTime: $('evt-time').value.trim(),
      location: $('evt-location').value.trim(),
      cost: $('evt-cost').value.trim(),
      externalLinkUrl: $('evt-link-url').value.trim(),
      externalLinkText: $('evt-link-text').value.trim() || 'Event Details',
      displayStartDate: $('evt-display-start').value,
      displayEndDate: $('evt-display-end').value,
      imageUrl: $('evt-image-url').value.trim(),
      highlights: highlights,
      status: status
    };
  }

  $('event-form').addEventListener('submit', function (e) {
    e.preventDefault();
    saveEvent();
  });

  function saveEvent() {
    var data = collectFormData();
    var btn = $('save-event-btn');
    setButtonLoading(btn, true);

    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    data.updatedBy = currentUser.uid;
    data.updatedByEmail = currentUser.email;

    var promise;
    if (editingEventId) {
      promise = db.collection('events').doc(editingEventId).update(data).then(function () {
        return addAuditEntry('event_updated', 'Updated event: ' + data.title, { eventId: editingEventId });
      });
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.createdBy = currentUser.uid;
      data.createdByEmail = currentUser.email;
      promise = db.collection('events').add(data).then(function (ref) {
        return addAuditEntry('event_created', 'Created event: ' + data.title, { eventId: ref.id });
      });
    }

    promise.then(function () {
      setButtonLoading(btn, false, 'Save Event');
      showToast(editingEventId ? 'Event updated!' : 'Event created!', 'success');
      closeEventForm();
      loadEvents();
    }).catch(function (err) {
      setButtonLoading(btn, false, 'Save Event');
      showToast('Error saving event: ' + err.message, 'error');
    });
  }

  function deleteEvent(evt) {
    db.collection('events').doc(evt.id).delete().then(function () {
      return addAuditEntry('event_deleted', 'Deleted event: ' + evt.title, { eventId: evt.id });
    }).then(function () {
      showToast('Event deleted.', 'success');
      loadEvents();
    }).catch(function (err) {
      showToast('Error: ' + err.message, 'error');
    });
    hideConfirm();
  }

  // ===================== IMAGE URL PREVIEW =====================

  function updateImagePreview() {
    var url = $('evt-image-url').value.trim();
    if (url) {
      $('image-preview').src = url;
      $('image-preview-container').classList.remove('hidden');
    } else {
      $('image-preview-container').classList.add('hidden');
    }
  }

  $('evt-image-url').addEventListener('change', updateImagePreview);
  $('evt-image-url').addEventListener('blur', updateImagePreview);

  // ===================== HIGHLIGHTS =====================

  function addHighlightRow(name, desc) {
    var row = document.createElement('div');
    row.className = 'highlight-row';
    row.innerHTML =
      '<input type="text" class="hl-name" placeholder="Name" value="' + escapeAttr(name || '') + '">' +
      '<input type="text" class="hl-desc" placeholder="Description" value="' + escapeAttr(desc || '') + '">' +
      '<button type="button" class="remove-highlight">&times;</button>';

    row.querySelector('.remove-highlight').addEventListener('click', function () {
      row.remove();
    });

    $('highlights-container').appendChild(row);
  }

  $('add-highlight-btn').addEventListener('click', function () {
    addHighlightRow('', '');
  });

  // ===================== EVENT PREVIEW =====================

  function showEventPreview(evtOrNull) {
    var evt = evtOrNull || collectFormData();
    renderPreview(evt);
  }

  function renderPreview(evt) {
    var container = $('preview-container');
    container.innerHTML = '';
    container.appendChild(buildEventCardDOM(evt));
    $('preview-modal').classList.remove('hidden');
  }

  $('preview-event-btn').addEventListener('click', function () {
    showEventPreview(null);
  });

  // ===================== BUILD EVENT CARD (shared renderer) =====================

  function buildEventCardDOM(evt) {
    var card = document.createElement('div');
    card.className = 'event-card';

    if (evt.imageUrl) {
      var img = document.createElement('img');
      img.src = evt.imageUrl;
      img.alt = evt.title + ' flyer';
      img.className = 'event-card-img';
      card.appendChild(img);
    }

    var details = document.createElement('div');
    details.className = 'event-details';

    var h4 = document.createElement('h4');
    h4.textContent = evt.title;
    details.appendChild(h4);

    if (evt.tagline) {
      var tagline = document.createElement('p');
      tagline.className = 'event-tagline';
      tagline.textContent = evt.tagline;
      details.appendChild(tagline);
    }

    if (evt.description) {
      var paragraphs = evt.description.split(/\n\s*\n/);
      paragraphs.forEach(function (p) {
        if (p.trim()) {
          var para = document.createElement('p');
          para.className = 'event-description';
          para.textContent = p.trim();
          details.appendChild(para);
        }
      });
    }

    if (evt.highlights && evt.highlights.length > 0) {
      var ul = document.createElement('ul');
      ul.className = 'gala-honorees';
      evt.highlights.forEach(function (h) {
        var li = document.createElement('li');
        if (h.name) {
          var strong = document.createElement('strong');
          strong.textContent = h.name;
          li.appendChild(strong);
          if (h.description) li.appendChild(document.createTextNode(' — ' + h.description));
        } else {
          li.textContent = h.description;
        }
        ul.appendChild(li);
      });
      details.appendChild(ul);
    }

    var infoGrid = document.createElement('div');
    infoGrid.className = 'event-info-grid';

    if (evt.eventDate) {
      infoGrid.appendChild(createInfoItem('date', 'Date', formatDate(evt.eventDate)));
    }
    if (evt.eventTime) {
      infoGrid.appendChild(createInfoItem('time', 'Time', evt.eventTime));
    }
    if (evt.location) {
      var locSpan = document.createElement('span');
      evt.location.split('\n').forEach(function (line, i) {
        if (i > 0) locSpan.appendChild(document.createElement('br'));
        locSpan.appendChild(document.createTextNode(line));
      });
      infoGrid.appendChild(createInfoItemEl('location', 'Location', locSpan));
    }
    if (evt.cost) {
      infoGrid.appendChild(createInfoItem('cost', 'Cost', evt.cost));
    }

    if (infoGrid.children.length > 0) {
      details.appendChild(infoGrid);
    }

    if (evt.externalLinkUrl) {
      var link = document.createElement('a');
      link.href = evt.externalLinkUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'btn-gold';
      link.textContent = evt.externalLinkText || 'Event Details';
      link.style.display = 'block';
      link.style.textAlign = 'center';
      link.style.maxWidth = '240px';
      link.style.margin = '0 auto';
      details.appendChild(link);
    }

    card.appendChild(details);
    return card;
  }

  var svgIcons = {
    date: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    time: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    location: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    cost: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
  };

  function createInfoItem(type, label, value) {
    var item = document.createElement('div');
    item.className = 'event-info-item';
    item.innerHTML = svgIcons[type];
    var div = document.createElement('div');
    var strong = document.createElement('strong');
    strong.textContent = label;
    var span = document.createElement('span');
    span.textContent = value;
    div.appendChild(strong);
    div.appendChild(span);
    item.appendChild(div);
    return item;
  }

  function createInfoItemEl(type, label, valueEl) {
    var item = document.createElement('div');
    item.className = 'event-info-item';
    item.innerHTML = svgIcons[type];
    var div = document.createElement('div');
    var strong = document.createElement('strong');
    strong.textContent = label;
    div.appendChild(strong);
    div.appendChild(valueEl);
    item.appendChild(div);
    return item;
  }

  // ===================== USER MANAGEMENT =====================

  function loadUsers() {
    db.collection('admins').get().then(function (snapshot) {
      var container = $('users-list');
      if (snapshot.empty) {
        container.innerHTML = '<p class="empty-state">No admin users found.</p>';
        return;
      }
      container.innerHTML = '';
      snapshot.forEach(function (doc) {
        var user = doc.data();
        user.uid = doc.id;
        var card = document.createElement('div');
        card.className = 'user-card';
        card.innerHTML =
          '<div class="user-card-info">' +
            '<h4>' + escapeHtml(user.name || 'Admin') + '</h4>' +
            '<p>' + escapeHtml(user.email) + '</p>' +
          '</div>';
        container.appendChild(card);
      });
    });
  }

  $('add-user-btn').addEventListener('click', function () {
    $('add-user-form-container').classList.toggle('hidden');
  });

  $('cancel-add-user').addEventListener('click', function () {
    $('add-user-form-container').classList.add('hidden');
    $('add-user-form').reset();
  });

  $('add-user-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('new-user-name').value.trim();
    var email = $('new-user-email').value.trim();
    var password = $('new-user-password').value;
    var btn = this.querySelector('button[type="submit"]');
    setButtonLoading(btn, true);

    var currentEmail = currentUser.email;
    var currentPassword = null;

    // To create a new user with Firebase client SDK, we need to use a workaround:
    // Create a secondary Firebase app to avoid signing out the current admin
    var secondaryApp;
    try {
      secondaryApp = firebase.app('secondary');
    } catch (err) {
      secondaryApp = firebase.initializeApp(firebase.app().options, 'secondary');
    }

    secondaryApp.auth().createUserWithEmailAndPassword(email, password).then(function (cred) {
      return cred.user.updateProfile({ displayName: name }).then(function () {
        return db.collection('admins').doc(cred.user.uid).set({
          name: name,
          email: email,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: currentUser.uid
        });
      }).then(function () {
        secondaryApp.auth().signOut();
        return addAuditEntry('user_created', 'Created admin user: ' + email, { newUserEmail: email });
      });
    }).then(function () {
      setButtonLoading(btn, false, 'Create Admin');
      showToast('Admin user created: ' + email, 'success');
      $('add-user-form').reset();
      $('add-user-form-container').classList.add('hidden');
      loadUsers();
    }).catch(function (err) {
      setButtonLoading(btn, false, 'Create Admin');
      showToast('Error: ' + err.message, 'error');
    });
  });

  // ===================== AUDIT LOG =====================

  function addAuditEntry(action, description, details) {
    return db.collection('audit_log').add({
      action: action,
      description: description,
      details: details || {},
      userId: currentUser ? currentUser.uid : null,
      userEmail: currentUser ? currentUser.email : null,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  function loadAuditLog() {
    db.collection('audit_log').orderBy('timestamp', 'desc').limit(100).get().then(function (snapshot) {
      var container = $('audit-list');
      if (snapshot.empty) {
        container.innerHTML = '<p class="empty-state">No activity recorded yet.</p>';
        return;
      }

      var table = document.createElement('table');
      table.className = 'audit-table';
      table.innerHTML =
        '<thead><tr>' +
          '<th>Date</th><th>User</th><th>Action</th><th>Description</th>' +
        '</tr></thead>';

      var tbody = document.createElement('tbody');
      snapshot.forEach(function (doc) {
        var entry = doc.data();
        var tr = document.createElement('tr');
        var ts = entry.timestamp ? entry.timestamp.toDate() : new Date();
        tr.innerHTML =
          '<td>' + ts.toLocaleString() + '</td>' +
          '<td>' + escapeHtml(entry.userEmail || 'System') + '</td>' +
          '<td>' + escapeHtml(entry.action) + '</td>' +
          '<td>' + escapeHtml(entry.description) + '</td>';
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      container.innerHTML = '';
      container.appendChild(table);
    });
  }

  // ===================== MODAL HANDLERS =====================

  $('add-event-btn').addEventListener('click', function () {
    openEventForm(null);
  });

  $('close-event-modal').addEventListener('click', closeEventForm);
  $('cancel-event-btn').addEventListener('click', closeEventForm);

  $('close-preview-modal').addEventListener('click', function () {
    $('preview-modal').classList.add('hidden');
  });

  // Close modals on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(function (backdrop) {
    backdrop.addEventListener('click', function () {
      this.closest('.modal').classList.add('hidden');
    });
  });

  // Confirm dialog
  $('confirm-ok').addEventListener('click', function () {
    if (confirmCallback) confirmCallback();
  });

  $('confirm-cancel').addEventListener('click', hideConfirm);

  // ===================== UTILITIES =====================

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

})();
