(function () {
  'use strict';

  var db = firebase.firestore();

  var svgIcons = {
    date: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    time: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    location: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    cost: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
  };

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function loadEvents() {
    var container = document.getElementById('dynamic-events');
    var wrapper = document.getElementById('upcoming-events-wrapper');
    if (!container || !wrapper) return;

    db.collection('events')
      .where('status', '==', 'published')
      .get()
      .then(function (snapshot) {
        var today = new Date().toISOString().split('T')[0];
        var events = [];

        snapshot.forEach(function (doc) {
          var data = doc.data();
          if (data.displayStartDate <= today && data.displayEndDate >= today) {
            events.push(data);
          }
        });

        if (events.length === 0) {
          wrapper.classList.add('hidden');
          return;
        }

        events.sort(function (a, b) {
          return a.eventDate < b.eventDate ? -1 : 1;
        });

        wrapper.classList.remove('hidden');

        var heading = wrapper.querySelector('h3');
        if (heading) {
          heading.textContent = events.length === 1 ? 'Upcoming Event' : 'Upcoming Events';
        }

        container.innerHTML = '';
        events.forEach(function (evt) {
          container.appendChild(buildEventCard(evt));
        });
      })
      .catch(function (err) {
        console.log('Events load error:', err);
        wrapper.classList.add('hidden');
      });
  }

  function buildEventCard(evt) {
    var card = document.createElement('div');
    card.className = 'event-card';

    if (evt.imageUrl) {
      var img = document.createElement('img');
      img.src = evt.imageUrl;
      img.alt = escapeHtml(evt.title) + ' flyer';
      img.className = 'event-card-img';
      img.loading = 'lazy';
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
      addInfoItem(infoGrid, 'date', 'Date', formatDate(evt.eventDate));
    }
    if (evt.eventTime) {
      addInfoItem(infoGrid, 'time', 'Time', evt.eventTime);
    }
    if (evt.location) {
      var locSpan = document.createElement('span');
      evt.location.split('\n').forEach(function (line, i) {
        if (i > 0) locSpan.appendChild(document.createElement('br'));
        locSpan.appendChild(document.createTextNode(line));
      });
      addInfoItemEl(infoGrid, 'location', 'Location', locSpan);
    }
    if (evt.cost) {
      addInfoItem(infoGrid, 'cost', 'Cost', evt.cost);
    }

    if (infoGrid.children.length > 0) {
      details.appendChild(infoGrid);
    }

    if (evt.externalLinkUrl) {
      var link = document.createElement('a');
      link.href = evt.externalLinkUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'btn btn-gold event-btn';
      link.textContent = evt.externalLinkText || 'Event Details';
      details.appendChild(link);
    }

    card.appendChild(details);
    return card;
  }

  function addInfoItem(grid, type, label, value) {
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
    grid.appendChild(item);
  }

  function addInfoItemEl(grid, type, label, valueEl) {
    var item = document.createElement('div');
    item.className = 'event-info-item';
    item.innerHTML = svgIcons[type];
    var div = document.createElement('div');
    var strong = document.createElement('strong');
    strong.textContent = label;
    div.appendChild(strong);
    div.appendChild(valueEl);
    item.appendChild(div);
    grid.appendChild(item);
  }

  document.addEventListener('DOMContentLoaded', loadEvents);
})();
