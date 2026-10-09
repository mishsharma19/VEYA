// IIT Mandi campus places + the drawn North Campus map.
//
// North Campus is drawn from the labelled campus image, in the same layout as that image
// (x/y are pixel positions on the 1280×607 image). Real-world coordinates for every
// North Campus place are derived from x/y with a transform fitted to OpenStreetMap
// landmarks (Auditorium Complex, Academic Block, Pine/Oak Mess, …) — accurate to ~25 m.
// South Campus places use OpenStreetMap coordinates where available; the rest can be
// pinned by students from the app ("📌 Pin on map").
window.CAMPUS = (() => {
  // image pixel -> lat/lng (similarity transform fitted to OSM control points)
  const T = { a: -0.5276131790093272, b: -0.17310915214711525, tx: 694.369514403756, ty: 1.8016263816694842 };
  const LAT0 = 31.78105, LNG0 = 76.99399, MY = 111000, MX = 111320 * Math.cos(31.78 * Math.PI / 180);
  const px2ll = (x, yDown) => { const y = -yDown; const e = T.a * x - T.b * y + T.tx, n = T.b * x + T.a * y + T.ty; return [+(LAT0 + n / MY).toFixed(6), +(LNG0 + e / MX).toFixed(6)]; };

  const P = [];
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  // shape: ['r', w, h, rot] rectangle · ['c', r] circle · ['e', rx, ry] ellipse · null = icon pin
  function north(cat, name, x, y, shape, desc, tags = '', label = null) {
    P.push({ id: slug('north-' + name), campus: 'North', cat, name, x, y, shape, label, desc, tags, geo: [...px2ll(x, y), 'img'] });
  }
  function other(campus, cat, name, desc, geo = null, tags = '') {
    P.push({ id: slug(campus.toLowerCase() + '-' + name), campus, cat, name, x: null, y: null, desc, tags, geo });
  }

  // ---------------- North Campus (drawn) ----------------
  // academic blocks
  north('academic', 'A-9', 1068, 165, ['c', 42], 'Academic building A-9 (round block at the east end of the academic row)', 'class lecture lab a block');
  north('academic', 'A-10', 880, 185, ['r', 150, 26, -6], 'Academic building A-10', 'class lecture lab a block');
  north('academic', 'A-11', 880, 138, ['r', 150, 26, -8], 'Academic building A-11', 'class lecture lab a block');
  north('academic', 'A-13', 640, 190, ['r', 130, 26, -3], 'Academic building A-13', 'class lecture lab a block');
  north('academic', 'A-14', 660, 135, ['r', 190, 28, -8], 'Academic building A-14', 'class lecture lab a block');
  north('academic', 'A-17', 385, 215, ['r', 120, 28, 0], 'Academic building A-17', 'class lecture lab a block');
  north('academic', 'A-18', 385, 158, ['r', 120, 28, 0], 'Academic building A-18', 'class lecture lab a block');
  north('academic', 'A-19', 112, 190, ['r', 48, 44, 0], 'Academic building A-19 (west end, next to Alder Mess)', 'class lecture lab a block');
  north('academic', 'Central Library', 497, 180, ['c', 32], 'Central Library: the round building in the academic row. Reading and discussion rooms.', 'study books read library', 'Library');

  // hostel blocks
  [['B-8', 540, 375, -8], ['B-9', 455, 370, -5], ['B-10', 387, 280, -5], ['B-11', 515, 318, -20], ['B-12', 500, 272, -5], ['B-13', 945, 285, 30],
   ['B-14', 865, 252, 0], ['B-15', 700, 250, -3], ['B-16', 720, 400, -3], ['B-17', 290, 355, -3], ['B-18', 605, 245, -3], ['B-19', 650, 305, -20],
   ['B-20', 813, 392, -3], ['B-21', 885, 325, -5], ['B-22', 920, 370, -10], ['B-23', 783, 322, 0], ['B-24', 190, 357, -3], ['B-26', 240, 270, -10]]
    .forEach(([n, x, y, r]) => north('hostel', n + ' Hostel Block', x, y, ['r', 80, 26, r], `Hostel block ${n}, North Campus`, 'room stay residence b block ' + n.toLowerCase(), n));

  // messes & canteens
  north('mess', 'Alder Mess', 185, 195, ['c', 28], 'Dining hall at the west end, next to A-19', 'food eat breakfast lunch dinner', 'Alder');
  north('mess', 'Tulsi Mess', 790, 162, ['r', 46, 34, -8], 'Dining hall in the academic row, next to Tragopan canteen', 'food eat breakfast lunch dinner', 'Tulsi');
  north('mess', 'Pine Mess', 785, 262, ['c', 26], 'Dining hall between the academic row and the hostels, next to Drongo canteen', 'food eat breakfast lunch dinner', 'Pine');
  north('mess', 'Oak Mess', 365, 345, ['c', 28], 'Dining hall among the western hostel blocks, next to Monal canteen', 'food eat breakfast lunch dinner', 'Oak');
  north('mess', 'Peepal Mess', 75, 362, ['r', 62, 34, 0], 'Dining hall at the west end, near the Gym', 'food eat breakfast lunch dinner', 'Peepal');
  north('canteen', 'Tragopan', 748, 205, null, 'Canteen next to Tulsi Mess', 'food snacks chai coffee');
  north('canteen', 'Drongo', 712, 284, null, 'Canteen next to Pine Mess', 'food snacks chai coffee');
  north('canteen', 'Monal', 322, 380, null, 'Canteen next to Oak Mess', 'food snacks chai coffee');

  // Village Square & facilities
  north('facility', 'Village Square', 1095, 395, ['e', 32, 58], 'Open square at the east end. Auditorium, Sports Complex, Health Centre and C V Raman Guest House are around it.', 'park lawn hangout', 'Village Sq.');
  north('facility', 'Auditorium Complex', 1180, 395, ['c', 42], 'Institute auditorium: talks, fests, performances', 'hall event fest show auditorium', 'Auditorium');
  north('facility', 'Health Centre', 1130, 272, ['r', 56, 40, 0], 'Campus medical centre, next to the Sports Complex', 'doctor medical hospital clinic sick emergency medicine', 'Health');
  north('facility', 'C V Raman Guest House', 1030, 420, ['r', 22, 110, 0], 'Institute guest house at Village Square, for visiting parents and guests', 'guest house stay parents visitors', 'Guest House');
  north('sports', 'Sports Complex', 1050, 290, ['r', 70, 58, 0], 'Indoor sports complex next to Village Square', 'badminton tt squash indoor sports', 'Sports');
  north('sports', 'Gym', 40, 395, ['r', 44, 24, 0], 'Gym near Peepal Mess', 'gym workout weights fitness');
  north('landmark', 'Fountain Area', 1218, 300, ['e', 30, 42], 'Fountain area beside the Auditorium', 'fountain hangout photos', 'Fountain');
  north('landmark', 'Faculty Quarters', 630, 500, null, 'Faculty residences along the southern edge of North Campus', 'faculty professor residence quarters');

  // named hostels — details from the Dean of Students hostel page (students.iitmandi.ac.in/deanstudents/hostels.php)
  // Exact buildings aren't published (except Surajtaal's B-26), so students can link them to a B-block from the app.
  const H = (name, campus, gender, blocks, warden) => other(campus, 'hostel', name + ' Hostel',
    `${gender} hostel, ${campus} Campus.${blocks ? ' Blocks: ' + blocks + '.' : ''} Warden: ${warden}.`, null, 'room stay residence warden ' + gender.toLowerCase());
  // Ganga & Saraswati sit just west of the Gym, beyond the left edge of the reference photo
  north('hostel', 'Ganga Hostel', -62, 372, ['r', 74, 30, 0], 'Boys hostel, North Campus, to the left (west) of the Gym. Warden: warden_ganga@iitmandi.ac.in.', 'room stay residence warden boys gym', 'Ganga');
  north('hostel', 'Saraswati Hostel', -62, 420, ['r', 74, 30, 0], 'Boys hostel, North Campus, to the left (west) of the Gym. Warden: warden_saraswati@iitmandi.ac.in.', 'room stay residence warden boys gym', 'Saraswati');
  P.filter((p) => p.x < 0).forEach((p) => { p.offImage = true; });
  H('Yamuna', 'North', 'Boys', '', 'warden_yamuna@iitmandi.ac.in');
  H('Beaskund', 'North', 'Girls', 'α, β, γ, δ', 'warden_beaskund@iitmandi.ac.in');
  H('Gaurikund', 'North', 'Girls', 'α, β, γ, δ', 'warden_gaurikund@iitmandi.ac.in');
  H('Dashir', 'North', 'Boys', 'α, β, γ', 'warden_dashir@iitmandi.ac.in');
  H('Suvalsar', 'North', 'Boys', 'α, β, γ', 'warden_suvalsar@iitmandi.ac.in');
  P.push({ id: 'north-surajtaal-hostel', campus: 'North', cat: 'hostel', name: 'Surajtaal Hostel', x: null, y: null,
    desc: 'Boys hostel, North Campus. Blocks: α, β, γ and B-26 (shown at B-26). Warden: warden_surajtaal@iitmandi.ac.in.', tags: 'room stay residence warden boys b-26',
    geo: [...px2ll(240, 270), 'img'] });
  ['Treepie', 'Red Start', 'Parakeet', 'Cuckoo'].forEach((n) => other('North', 'canteen', n, 'Canteen (location not pinned yet)', null, 'food snacks chai coffee'));
  other('North', 'canteen', 'Lucknow Foods', 'Café near the academic area', [31.78437, 76.99631, 'approx'], 'food snacks');

  // ---------------- South Campus ----------------
  H('Manimahesh', 'South', 'Boys', 'one block (B8)', 'warden_manimahesh@iitmandi.ac.in');
  H('Nako', 'South', 'Boys', 'α, β, γ', 'warden_nako@iitmandi.ac.in');
  H('Prashar', 'South', 'Boys', 'α, β, γ, δ', 'warden_parashar@iitmandi.ac.in');
  H('Renuka', 'South', 'Girls', 'α, β, γ', 'warden_renuka@iitmandi.ac.in');
  H('Chandrataal', 'South', 'Girls', 'Chandrataal and Chandrataal Annex', 'warden_chandrataal@iitmandi.ac.in');
  H('Rewalsar', 'South', 'Boys', '', 'warden_rewalsar@iitmandi.ac.in');
  ['Cedar (D1)', 'Maple (D2)', 'Gulmohar (D3)', 'Amaltaas', 'Sanobar'].forEach((n) => other('South', 'mess', n + ' Mess', 'South Campus dining hall', null, 'food eat breakfast lunch dinner d1 d2 d3'));
  ['Magpie', 'Sunbird', 'Bulbul', 'Barbet'].forEach((n) => other('South', 'canteen', n, 'South Campus canteen', null, 'food snacks chai coffee'));
  other('South', 'canteen', 'Cafe Alimantaire', 'Café popular for parathas', null, 'food paratha snacks');
  other('South', 'academic', 'South Campus Library', 'Library with reading and discussion rooms', null, 'study books read');
  other('South', 'academic', 'Computer Lab', 'South Campus computer lab', [31.77383, 76.98452, 'approx'], 'computers lab pc');
  other('South', 'facility', 'Medical Unit', 'Medical unit on the Kamand (South) campus', [31.77321, 76.98654, 'approx'], 'doctor medical clinic sick emergency medicine');
  other('South', 'sports', 'Cricket Ground', 'South Campus cricket ground', null, 'cricket nets match');
  other('South', 'sports', 'Sports Ground', 'Football, athletics and fest events', null, 'football athletics run');

  // ---------------- Around campus ----------------
  other('Around', 'landmark', 'Hospital in Kamand', 'Hospital in Kamand village, next to South Campus', [31.77651, 76.98767, 'approx'], 'doctor medical emergency');
  other('Around', 'landmark', 'Uhl River', 'The river that runs through the Kamand valley', null, 'river walk');
  other('Around', 'landmark', 'Kamand Market', 'Local market a short distance from South Campus', null, 'shop market groceries');
  other('Around', 'landmark', 'Peepul’s Point', 'Viewpoint near South Campus', null, 'view walk');
  other('Around', 'landmark', 'Markandeya Temple', 'Hilltop temple (Dev Ghanpathan Rishi Markandeya): about a 3 km trek, open on certain days', null, 'temple trek hike');

  // ---------------- decoration for the drawn map ----------------
  const DECOR = {
    zones: [
      { cls: 'z-west', pts: '20,150 215,112 232,250 150,292 110,412 20,448 -112,452 -112,338 20,330' },
      { cls: 'z-acad', pts: '228,118 330,103 560,108 760,78 1000,58 1110,88 1138,160 1100,218 1000,238 800,228 640,218 480,242 340,246 232,242' },
      { cls: 'z-host', pts: '150,256 330,250 480,248 640,228 800,236 950,240 1000,262 1000,300 962,345 936,405 880,425 700,428 560,404 450,398 330,392 150,390 112,350 130,292' },
      { cls: 'z-fac', pts: '140,400 330,400 560,412 700,438 880,432 962,414 1050,454 1040,520 900,546 700,578 480,578 320,546 200,486 150,446' },
      { cls: 'z-vil', pts: '1004,250 1110,228 1200,238 1265,278 1272,445 1210,475 1100,485 1010,455 1000,380' },
    ],
    roads: [
      'M20 255 C200 250 400 250 560 240 C700 228 850 230 990 250 C1050 258 1100 236 1180 234 L1275 248',
      'M110 398 C300 396 500 402 620 422 C760 444 900 424 1000 452 C1080 474 1180 480 1275 470',
      'M1000 250 L1003 460',
      'M20 145 C200 92 400 62 600 72 C800 56 1000 42 1130 70 C1180 84 1230 118 1275 158',
    ],
    river: 'M-40 470 C60 520 140 580 260 660',
    zoneNames: [{ x: 930, y: 92, t: 'ACADEMIC AREA' }, { x: 180, y: 312, t: 'HOSTELS' }],
    southSign: { x: 1050, y: 18, label: 'South Campus ↗ about 1 km' },
    north: [-0.3117, 0.9502], // direction of true north on the drawing (x, y-down)
    size: [1280, 607],
  };

  // Campus reference points (OpenStreetMap)
  const AREAS = [
    { name: 'North Campus', lat: 31.7826, lng: 76.9975 },
    { name: 'South Campus', lat: 31.775554, lng: 76.986541 },
  ];

  const CATS = {
    hostel: { label: 'Hostels', icon: '🏠', color: '#9cb52a' },
    mess: { label: 'Messes', icon: '🍛', color: '#e0892e' },
    canteen: { label: 'Canteens', icon: '☕', color: '#d24f86' },
    academic: { label: 'Academic', icon: '🏛️', color: '#7c5cf0' },
    facility: { label: 'Facilities', icon: '🏥', color: '#2fa37a' },
    sports: { label: 'Sports', icon: '🏟️', color: '#e0583a' },
    landmark: { label: 'Landmarks', icon: '📍', color: '#64748b' },
  };
  return { places: P, cats: CATS, areas: AREAS, decor: DECOR, px2ll, center: [31.7784, 76.9915] };
})();
