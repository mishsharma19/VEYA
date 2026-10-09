// Communities and sub-communities. Edit freely to match the current
// Student Gymkhana club list — every sub-community becomes a chat room.
const sub = (id, name, icon, desc) => ({ id, name, icon, desc });

const COMMUNITIES = [
  {
    id: 'campus', cat: 'Community', name: 'Kamand Campus', short: 'Campus', icon: '🏔️', color: '#3a86a8',
    desc: 'Everything IIT Mandi — North & South campus, Kamand valley',
    subs: [
      sub('general', 'general', '💬', 'Campus-wide chatter'),
      { ...sub('announcements', 'announcements', '📢', 'Official notices from the core team (only admins can post)'), adminOnly: true },
      sub('lost-found', 'lost-and-found', '🔎', 'Lost something between North and South campus?'),
      sub('mess', 'mess-and-food', '🍛', 'Mess menus, canteens, late-night Maggi'),
      sub('rides', 'rides-and-cabs', '🚌', 'Share cabs to Mandi town, Chandigarh, Delhi'),
      sub('buy-sell', 'buy-and-sell', '🛒', 'Cycles, books, mattresses, lab coats'),
      sub('treks', 'treks-and-outdoors', '🥾', 'Prashar, Shikari Devi, Uhl riverside walks'),
    ],
  },
  {
    id: 'sntc', cat: 'Tech', name: 'SnTC — Science & Technology Council', short: 'SnTC', icon: '⚙️', color: '#2f8f6b',
    desc: 'IIT Mandi’s technical society. Every club is open to all students; major events are Inter IIT Tech Meet, Avishkar and Utkarsh',
    subs: [
      sub('general', 'sntc-general', '💬', 'All of SnTC'),
      sub('robotronics', 'Robotronics', '🤖', 'Robotics + Electronics = Robotronics: analog and digital electronics and robotics, with workspace, tools and mentors for building smart machines'),
      sub('kamandprompt', 'KP — KamandPrompt', '💻', 'The programming club: coding contests, workshops and competitions, plus guest lectures with the ACM chapter'),
      sub('saic', 'SAIC', '🧠', 'SAIC, an SnTC club: projects, sessions and events. Ask in the chat to learn more'),
      sub('sae', 'SAE Collegiate', '🏎️', 'Collegiate chapter of SAE India: hands-on automotive engineering beyond the classroom'),
      sub('kbg', 'KBG — Kamand BioEngineering Group', '🧬', 'Bioengineering projects, talks and hands-on work in biology and health tech'),
      sub('yantrik', 'Yantrik', '🔧', 'The mechanical engineering club: events, projects and putting classroom learning into action'),
      sub('nirmaan', 'Nirmaan', '🏗️', 'The civil engineering club: events, workshops, expert talks and site visits beyond academics'),
      sub('stac', 'STAC — Space Technology & Astronomy Cell', '🔭', 'Astronomy and space tech for everyone: telescopes, sky-watching and space projects'),
      sub('ecell', 'E-Cell', '🚀', 'Student-run Entrepreneurship Cell: workshops and sessions that build entrepreneurial skills'),
      sub('cg2d', 'CG2D — Computer Graphics & Game Dev', '🎮', 'Game development cell: game design, 3D modeling, animation and real-time rendering through hands-on sessions, projects and talks'),
    ],
  },
  {
    id: 'cultsoc', cat: 'Cultural', name: 'Cult Soc — Cultural Society', short: 'Cult Soc', icon: '🎭', color: '#c2603a',
    desc: 'Clubs for the fine arts (music, dance, drama, art, design, film) plus the Literary Society',
    subs: [
      sub('general', 'cult-general', '💬', 'All of Cult Soc'),
      sub('music', 'Music Club', '🎸', 'Encouraging, practising and performing many genres of music: classical, western, fusion and more'),
      sub('dance', 'UDC — Uhl Dance Crew', '💃', 'The dance club: regular practice, workshops with choreographers and performances at campus fests'),
      sub('drama', 'Drama Club', '🎬', 'Full-length plays in Hindi and English, street plays (nukkad natak) and skits'),
      { ...sub('uhllekh', 'Uhl Lekh', '✒️', 'The writing club: poetry, stories and creative writing'), group: 'Literary Society' },
      { ...sub('qurosity', 'Qurosity', '❓', 'The quizzing club: general, sci-tech, pop-culture and business quizzes'), group: 'Literary Society' },
      { ...sub('tsod', 'TSOD — The Society of Debaters', '🎤', 'The debating club: debates in many formats, group discussions and JAMs'), group: 'Literary Society' },
      { ...sub('pubmedia', 'Griffinsight — Publicity & Media', '📣', 'The student media body: campus news, publicity and event coverage'), group: 'Literary Society' },
      sub('pmc', 'PMC — Photography & Movie Club', '📷', 'Photography (Shutterbugs) and movie-making (Perception): shoots, short films and screenings across the Kamand valley'),
      sub('artgeeks', 'Art Geeks', '🎨', 'Fine arts and digital art: sketching, painting and Photoshop designs'),
      sub('designauts', 'Designauts', '✏️', 'The designing club: posters, branding and visual design for campus events and fests'),
      sub('spicmacay', 'SPIC MACAY', '🪕', 'Society for the Promotion of Indian Classical Music and Culture Amongst Youth: concerts, workshops and heritage'),
    ],
  },
  {
    id: 'sports', cat: 'Sports', name: 'Sports Society', short: 'Sports', icon: '🏆', color: '#d19a2a',
    desc: 'Coaches, facilities and training for Inter-IIT and other tournaments; organises the annual sports fest Rann-Neeti',
    subs: [
      sub('general', 'sports-general', '💬', 'All of Sports Soc'),
      sub('cricket', 'Cricket', '🏏', 'Nets, matches, Inter-IIT prep'),
      sub('football', 'Football', '⚽', 'Evening games on the ground'),
      sub('basketball', 'Basketball', '🏀', 'Courts and pickup games'),
      sub('volleyball', 'Volleyball', '🏐', 'Spikes and serves'),
      sub('badminton', 'Badminton', '🏸', 'Court booking and doubles partners'),
      sub('tabletennis', 'Table Tennis', '🏓', 'TT room regulars'),
      sub('tennis', 'Lawn Tennis', '🎾', 'Court slots and coaching'),
      sub('athletics', 'Athletics', '🏃', 'Track, field and hill runs'),
      sub('hockey', 'Hockey', '🏑', 'Practice and matches'),
      sub('chess', 'Chess', '♟️', 'Blitz, rapid, tournaments'),
      sub('kabaddi', 'Kabaddi', '🤼', 'Raids and tackles'),
      sub('squash', 'Squash', '🟢', 'Court slots'),
      sub('gym', 'Weightlifting & Gym', '🏋️', 'Splits, PRs, gym timings'),
      sub('yoga', 'Yoga', '🧘', 'Morning sessions with a view'),
    ],
  },
  {
    id: 'extra', cat: 'Extra-curricular', name: 'Extra Curriculars', short: 'Extra Curriculars', icon: '🌟', color: '#0ea5e9',
    desc: 'Hiking & trekking, national sports training and national service programmes',
    subs: [
      sub('general', 'extra-general', '💬', 'All of Extra Curriculars'),
      sub('hnt', 'HnT — Hiking & Trekking Club', '🥾', 'Hikes and treks in the Himalayas around Kamand: trip plans, gear and trail stories'),
      sub('nso', 'NSO — National Sports Organisation', '🏅', 'Structured sports training under the national NSO programme'),
      sub('nss', 'NSS — National Service Scheme', '🤝', 'Community service and social outreach: drives, camps and volunteering'),
      sub('ncc', 'NCC — National Cadet Corps', '🎖️', 'Cadet training: drills, discipline, camps and leadership'),
    ],
  },
];

// Sample events, generated relative to "now" in IST so the feed is never empty.
// They carry sample:true so the UI labels them — delete or replace them.
function SEED_EVENTS() {
  const IST = 330 * 60000;
  const at = (days, h, m = 0) => {
    const nowIst = new Date(Date.now() + IST);
    const t = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() + days, h, m) - IST;
    return new Date(t).toISOString();
  };
  const ev = (id, title, community, days, sh, eh, venue, desc) => ({
    id, title, communityId: community, start: at(days, sh), end: at(days, eh), venue, desc,
    createdBy: 'system', createdAt: new Date().toISOString(), rsvps: [], sample: true,
  });
  return [
    ev('s1', 'Inter-hostel Football — Semis', 'sports', 2, 16, 18, 'Sports Ground, South Campus', 'Come cheer for your hostel!'),
    ev('s2', 'KamandPrompt Weekly Contest', 'sntc', 3, 21, 23, 'Online', '2-hour contest, 6 problems. Bring your best templates.'),
    ev('s3', 'Music Club Open Jam', 'cultsoc', 5, 19, 21, 'Nako Hostel, South Campus', 'Bring an instrument or just your voice.'),
    ev('s4', 'Open Quiz Night', 'cultsoc', 7, 18, 20, 'North Campus Auditorium', 'Teams of up to 3. Prizes for top 3.'),
    ev('s5', 'STAC Star Gazing Night', 'sntc', 9, 21, 23, 'Open ground, South Campus', 'Telescopes provided. Dress warm!'),
    ev('s6', 'Utkarsh — Technical Fest', 'sntc', 20, 10, 18, 'North Campus', 'Annual in-house tech event with competitions by every SnTC club.'),
    ev('s7', 'Rann-Neeti — Sports Fest Opening', 'sports', 35, 9, 12, 'Sports Ground, South Campus', 'Opening ceremony of the annual sports fest.'),
  ];
}

module.exports = { COMMUNITIES, SEED_EVENTS };
