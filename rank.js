// ===== Helpers =====
function $(sel, root=document){ return root.querySelector(sel); }
function createEl(tag, cls){ const e=document.createElement(tag); if(cls) e.className=cls; return e; }
function toast(msg){
  const t=$("#toast");
  t.textContent=msg;
  t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"),2000);
}

// ===== Global State =====
let teamsData = null;             // raw from teams.json
let groupsList = [];              // [{groupName, teams:[{teamName,players:[]}, ...]}]
let teamToGroup = {};             // { "FC A1": "Bảng A", ... }
let allTeamNames = [];            // ["FC A1","FC B1",...]
let allMatches = [];              // [{path, data}, ...]
let cardDetailsMap = {};          // teamName -> [ {matchLabel, minute, cardType, playerName, playerNumber} ]
let teamCardsMap   = {};          // teamName -> {yellow:x, red:y}
let allMatchesHistory = [];       // [{time, group, homeTeam, awayTeam, homeScore, awayScore, matchFile, details}]

// ===== Load teams.json =====
async function loadTeamsJson(){
  try{
    const r = await fetch("teams.json",{cache:"no-cache"});
    if(!r.ok){
      console.warn("Không đọc được teams.json");
      toast("Không đọc được teams.json");
      return;
    }
    teamsData = await r.json();
    buildGroupsAndMap();
  }catch(e){
    console.error("Lỗi đọc teams.json:", e);
    toast("Lỗi đọc teams.json");
  }
}

// phân tích cấu trúc teams.json -> nhóm / đội
function buildGroupsAndMap(){
  groupsList = [];
  teamToGroup = {};
  allTeamNames = [];

  if(!teamsData) return;
  const mode = (teamsData.cheDo||"").toLowerCase();

  if(mode==="bang"){
    // cho phép dùng "bangs", "bang", hoặc "groups"
    let rawGroups = [];
    if(Array.isArray(teamsData.bangs)){
      rawGroups = teamsData.bangs;
    }else if(Array.isArray(teamsData.bang)){
      rawGroups = teamsData.bang;
    }else if(Array.isArray(teamsData.groups)){
      rawGroups = teamsData.groups;
    }

    rawGroups.forEach(bg=>{
      const gName = bg.tenBang || bg.ten || "Bảng ?";
      const gObj = { groupName:gName, teams:[] };

      // "doi" hoặc "teams"
      const teamArr = Array.isArray(bg.doi)? bg.doi
                    : Array.isArray(bg.teams)? bg.teams
                    : [];

      teamArr.forEach(d=>{
        const tName = d.tenDoi || d.name || "";
        if(!tName) return;
        const players = Array.isArray(d.cauThu)? d.cauThu
                        : Array.isArray(d.players)? d.players
                        : [];
        gObj.teams.push({ teamName:tName, players });
        teamToGroup[tName] = gName;
        allTeamNames.push(tName);
      });

      groupsList.push(gObj);
    });

    if(!groupsList.length){
      groupsList.push({groupName:"Khác", teams:[]});
    }

  } else {
    // chế độ vòng tròn
    const gName = "Bảng xếp hạng";
    const gObj  = { groupName:gName, teams:[] };

    const listTeams = Array.isArray(teamsData.doi)? teamsData.doi
                     : Array.isArray(teamsData.teams)? teamsData.teams
                     : [];

    listTeams.forEach(d=>{
      const tName = d.tenDoi || d.name || "";
      if(!tName) return;
      const players = Array.isArray(d.cauThu)? d.cauThu
                      : Array.isArray(d.players)? d.players
                      : [];
      gObj.teams.push({ teamName:tName, players });
      teamToGroup[tName] = gName;
      allTeamNames.push(tName);
    });

    groupsList.push(gObj);
  }
}

// ===== Load matches from index.json + từng file =====
async function loadMatchesFromIndex(){
  allMatches = [];
  cardDetailsMap = {};
  teamCardsMap   = {};

  try{
    const r = await fetch("index.json",{cache:"no-cache"});
    if(!r.ok){
      console.warn("Không đọc được index.json");
      toast("Không đọc được index.json");
      return;
    }
    const idx = await r.json();

    // Cho phép 2 format:
    // 1. { "matches": ["matches/xxx.json", ...] }
    // 2. ["matches/xxx.json", ...]
    let files = [];
    if(Array.isArray(idx)){
      files = idx;
    }else if(Array.isArray(idx.matches)){
      files = idx.matches;
    }else{
      files = [];
    }

    for(const path of files){
      try{
        const rr = await fetch(path,{cache:"no-cache"});
        if(!rr.ok){
          console.warn("Lỗi đọc",path);
          continue;
        }
        const data = await rr.json();
        allMatches.push({ path, data });
      }catch(e){
        console.warn("Lỗi parse",path,e);
      }
    }

    $("#matchCountLabel").textContent = `(${allMatches.length} trận đã nạp)`;

  }catch(e){
    console.error("Lỗi đọc index.json:", e);
    toast("Lỗi đọc index.json");
  }
}

// ===== Tính BXH + thống kê =====
function computeAllStats(){
  // standings per group: { groupName -> {teamName -> statsRecord} }
  const standMap = {};

  // scorers map: key "player@@team" -> {playerName, teamName, goals}
  const scorersMap = {};

  // cardsAgg map: key "player@@team" -> {playerName, teamName, yellow, red}
  const cardsAggMap = {};

  // reset cho thẻ theo đội
  cardDetailsMap = {};
  teamCardsMap   = {};
  
  // reset lịch sử trận đấu
  allMatchesHistory = [];

  // 1) duyệt toàn bộ trận để cập nhật thống kê
  allMatches.forEach(m=>{
    const d=m.data;
    if(!d || !d.teams || !d.teams.A || !d.teams.B) return;

    const teamAName = d.teams.A.name || "Đội A";
    const teamBName = d.teams.B.name || "Đội B";
    const scoreA    = Number(d.teams.A.score||0);
    const scoreB    = Number(d.teams.B.score||0);

    // đội thuộc bảng nào?
    const gA = teamToGroup[teamAName] || "Khác";
    const gB = teamToGroup[teamBName] || "Khác";
    // Lấy bảng chung (nếu hai đội khác bảng thì lấy bảng của đội nhà)
    const matchGroup = gA;

    // Lưu lịch sử trận đấu
  // Lưu lịch sử trận đấu
let matchTime = "";

// Lấy từ meta nếu có
if (d.meta) {
  const date = d.meta.date || "";
  const time = d.meta.time || "";
  if (date && time) {
    matchTime = `${date} ${time}`;
  } else if (date) {
    matchTime = date;
  } else if (time) {
    matchTime = time;
  }
}

// Fallback sang các trường cũ nếu không có meta
if (!matchTime) {
  matchTime = d.time || d.date || d.thoiGian || "";
}

// Thử parse timestamp nếu có (ở cấp độ cao nhất)
if (!matchTime && d.timestamp) {
  const date = new Date(d.timestamp * 1000);
  matchTime = date.toLocaleString("vi-VN");
}

// Nếu vẫn không có, để "Không rõ"
if (!matchTime) matchTime = "Không rõ";
    
    allMatchesHistory.push({
      time: matchTime || "Không rõ",
      group: matchGroup,
      homeTeam: teamAName,
      awayTeam: teamBName,
      homeScore: scoreA,
      awayScore: scoreB,
      matchFile: m.path,
      details: d
    });

    // chuẩn bị obj BXH (nếu chưa có)
    if(!standMap[gA]) standMap[gA]={};
    if(!standMap[gA][teamAName]) standMap[gA][teamAName] = blankTeamStats(teamAName);
    if(!standMap[gB]) standMap[gB]={};
    if(!standMap[gB][teamBName]) standMap[gB][teamBName] = blankTeamStats(teamBName);

    // cập nhật BXH từ kết quả trận
    updateStandRecord(standMap[gA][teamAName], scoreA, scoreB);
    updateStandRecord(standMap[gB][teamBName], scoreB, scoreA);

    // ===== VUA PHÁ LƯỚI: BỎ QUA PHẢN LƯỚI =====
    const goalsArr = Array.isArray(d.goals)? d.goals: [];
    goalsArr.forEach(g=>{
      const tName = g.teamName || "";
      const pName = g.playerName || "";
      if(!tName || !pName) return;

      const typeStr = (g.type||"").toLowerCase();
      const isOwn = g.ownGoal === true || typeStr === "own" || typeStr === "phản lưới";
      if(isOwn) return; // không cộng vào vua phá lưới

      const key = pName+"@@"+tName;
      if(!scorersMap[key]){
        scorersMap[key] = {playerName:pName, teamName:tName, goals:0};
      }
      scorersMap[key].goals += 1;
    });

    // thống kê thẻ
    const cardsArr = Array.isArray(d.cards)? d.cards: [];
    cardsArr.forEach(c=>{
      const tName = c.teamName || "";
      const pName = c.playerName || "";
      const ctype = (c.cardType||"").toLowerCase(); // "vàng"/"đỏ"
      const minute= c.minute || "";
      const matchLabel = `${teamAName} ${scoreA}-${scoreB} ${teamBName}`;

      // cộng dồn cho từng cầu thủ
      const pKey = pName+"@@"+tName;
      if(!cardsAggMap[pKey]){
        cardsAggMap[pKey] = {
          playerName:pName,
          teamName:tName,
          yellow:0,
          red:0
        };
      }
      if(ctype.includes("vàng")) cardsAggMap[pKey].yellow += 1;
      if(ctype.includes("đỏ"))   cardsAggMap[pKey].red    += 1;

      // cộng dồn theo đội
      if(!teamCardsMap[tName]){
        teamCardsMap[tName] = {yellow:0, red:0};
      }
      if(ctype.includes("vàng")) teamCardsMap[tName].yellow += 1;
      if(ctype.includes("đỏ"))   teamCardsMap[tName].red    += 1;

      // lưu chi tiết từng thẻ để hiển thị "Thẻ theo đội"
      if(!cardDetailsMap[tName]) cardDetailsMap[tName]=[];
      cardDetailsMap[tName].push({
        matchLabel,
        minute,
        cardType:c.cardType || "",
        playerName:pName,
        playerNumber:c.playerNumber || ""
      });
    });
  });

  // 2) Bổ sung tất cả đội từ teams.json -> đội chưa đá vẫn hiện
  groupsList.forEach(group=>{
    const gName = group.groupName || "Khác";
    if(!standMap[gName]) standMap[gName] = {};
    group.teams.forEach(t=>{
      const tName = t.teamName;
      if(!standMap[gName][tName]){
        standMap[gName][tName] = blankTeamStats(tName);
      }
    });
  });

  // 3) chuẩn hoá BXH theo từng bảng
  const standingsByGroup = [];
  Object.keys(standMap).forEach(gName=>{
    const obj = standMap[gName];
    const arr = Object.values(obj).map(rec=>{
      rec.gd = rec.gf - rec.ga;
      return rec;
    });

    // sắp xếp theo: Điểm ↓, HS ↓, BT ↓, rồi tên ↑
    arr.sort((a,b)=>{
      if(b.points!==a.points) return b.points-a.points;
      if(b.gd!==a.gd) return b.gd-a.gd;
      if(b.gf!==a.gf) return b.gf-a.gf;
      return a.name.localeCompare(b.name,"vi");
    });

    // gán hạng
    arr.forEach((r,idx)=>{ r.rank=idx+1; });

    standingsByGroup.push({
      groupName:gName,
      rows:arr
    });
  });

  // 4) vua phá lưới (đã bỏ phản lưới)
  const scorersArr = Object.values(scorersMap);
  scorersArr.sort((a,b)=>{
    if(b.goals!==a.goals) return b.goals-a.goals;
    return a.playerName.localeCompare(b.playerName,"vi");
  });

  // 5) tổng thẻ từng cầu thủ
  const cardsAggArr = Object.values(cardsAggMap);
  cardsAggArr.sort((a,b)=>{
    // ưu tiên nhiều đỏ hơn, sau đó vàng
    if(b.red!==a.red) return b.red-a.red;
    if(b.yellow!==a.yellow) return b.yellow-a.yellow;
    return a.playerName.localeCompare(b.playerName,"vi");
  });
  
  // 6) Sắp xếp lịch sử trận đấu theo thời gian (mới nhất lên đầu)
  allMatchesHistory.sort((a, b) => {
    // Thử sắp xếp theo timestamp nếu có
    if (a.details?.timestamp && b.details?.timestamp) {
      return b.details.timestamp - a.details.timestamp;
    }
    // Fallback: sắp xếp theo tên file (thường có thứ tự thời gian)
    return b.matchFile.localeCompare(a.matchFile);
  });

  return {standingsByGroup, scorersArr, cardsAggArr};
}

function blankTeamStats(name){
  return {
    name,
    played:0,
    win:0,
    draw:0,
    loss:0,
    gf:0,
    ga:0,
    gd:0,
    points:0,
    rank:0
  };
}
function updateStandRecord(rec, gf, ga){
  rec.played +=1;
  rec.gf += gf;
  rec.ga += ga;
  if(gf>ga){
    rec.win +=1;
    rec.points +=3;
  }else if(gf===ga){
    rec.draw +=1;
    rec.points +=1;
  }else{
    rec.loss +=1;
  }
}

// ===== Render =====
function renderStandings(standingsByGroup){
  const wrap=$("#standingsWrap");
  wrap.innerHTML="";

  if(!standingsByGroup.length){
    wrap.innerHTML=`<div class="dim smalltxt">(Không có BXH)</div>`;
    return;
  }

  standingsByGroup.forEach(g=>{
    const card = createEl("div","stand-card");

    const head = createEl("div","stand-head");
    const left = createEl("div","stand-head-left");
    left.textContent = g.groupName;
    const right = createEl("div","stand-head-right");
    right.textContent = `${g.rows.length} đội`;

    head.appendChild(left);
    head.appendChild(right);

    const tableWrap = createEl("div","table-wrap");
    const table = createEl("table","table small-table");

    table.innerHTML=`
      <thead>
        <tr>
          <th>Hạng</th>
          <th>Đội</th>
          <th>Trận</th>
          <th>Thắng</th>
          <th>Hòa</th>
          <th>Thua</th>
          <th>BT</th>
          <th>BB</th>
          <th>HS</th>
          <th>Điểm</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    if(!g.rows.length){
      tbody.innerHTML=`<tr><td colspan="10" class="dim">(Chưa có dữ liệu)</td></tr>`;
    }else{
      g.rows.forEach(r=>{
        const tr=createEl("tr");
        tr.innerHTML=`
          <td>${r.rank}</td>
          <td>${r.name}</td>
          <td>${r.played}</td>
          <td>${r.win}</td>
          <td>${r.draw}</td>
          <td>${r.loss}</td>
          <td>${r.gf}</td>
          <td>${r.ga}</td>
          <td>${r.gf-r.ga}</td>
          <td>${r.points}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    tableWrap.appendChild(table);
    card.appendChild(head);
    card.appendChild(tableWrap);
    wrap.appendChild(card);
  });
}

function renderScorers(scorersArr){
  const tb=$("#scorerTbody");
  tb.innerHTML="";
  if(!scorersArr.length){
    tb.innerHTML=`<tr><td colspan="4" class="dim">(không có dữ liệu)</td></tr>`;
    return;
  }
  scorersArr.forEach((s,idx)=>{
    const tr=createEl("tr");
    tr.innerHTML=`
      <td>${idx+1}</td>
      <td>${s.playerName}</td>
      <td>${s.teamName}</td>
      <td>${s.goals}</td>
    `;
    tb.appendChild(tr);
  });
}

function renderCardsAgg(cardsAggArr){
  const tb=$("#cardsAggTbody");
  tb.innerHTML="";
  if(!cardsAggArr.length){
    tb.innerHTML=`<tr><td colspan="5" class="dim">(không có dữ liệu)</td></tr>`;
    return;
  }
  cardsAggArr.forEach((c,idx)=>{
    const tr=createEl("tr");
    tr.innerHTML=`
      <td>${idx+1}</td>
      <td>${c.playerName}</td>
      <td>${c.teamName}</td>
      <td>${c.yellow||0}</td>
      <td>${c.red||0}</td>
    `;
    tb.appendChild(tr);
  });
}

// dropdown đội cho phần "Thẻ theo đội"
function fillTeamFilterDropdown(){
  const sel=$("#teamFilterSelect");
  sel.innerHTML="";
  sel.appendChild(new Option("-- Chọn đội --",""));
  const uniq = [...new Set(allTeamNames)].sort((a,b)=>a.localeCompare(b,"vi"));
  uniq.forEach(n=>{
    sel.appendChild(new Option(n,n));
  });
}

function renderTeamCardDetail(){
  const sel=$("#teamFilterSelect");
  const tname = sel.value;
  const detailTbody=$("#teamCardsDetailTbody");
  const tot=$("#teamCardTotals");

  if(!tname){
    detailTbody.innerHTML=`<tr><td colspan="5" class="dim">(chọn đội để xem)</td></tr>`;
    tot.textContent="Vàng: 0 · Đỏ: 0";
    return;
  }

  const cards = cardDetailsMap[tname] || [];
  const totals = teamCardsMap[tname] || {yellow:0,red:0};
  tot.textContent = `Vàng: ${totals.yellow||0} · Đỏ: ${totals.red||0}`;

  detailTbody.innerHTML="";
  if(!cards.length){
    detailTbody.innerHTML=`<tr><td colspan="5" class="dim">(đội này chưa nhận thẻ)</td></tr>`;
    return;
  }

  cards.forEach((c,idx)=>{
    const tr=createEl("tr");
    tr.innerHTML=`
      <td>${idx+1}</td>
      <td>${c.matchLabel}</td>
      <td>${c.minute}'</td>
      <td>${c.cardType}</td>
      <td>${c.playerNumber?c.playerNumber+" - ":""}${c.playerName}</td>
    `;
    detailTbody.appendChild(tr);
  });
}

// ===== Hàm render lịch sử trận đấu =====
function renderMatchesHistory() {
  const teamFilter = $("#matchFilterTeam").value;
  const groupFilter = $("#matchFilterGroup").value;
  const tbody = $("#matchesHistoryTbody");
  const totalSpan = $("#totalMatchesCount");
  
  // Lọc trận đấu
  let filteredMatches = allMatchesHistory;
  
  if (teamFilter) {
    filteredMatches = filteredMatches.filter(m => 
      m.homeTeam === teamFilter || m.awayTeam === teamFilter
    );
  }
  
  if (groupFilter) {
    filteredMatches = filteredMatches.filter(m => m.group === groupFilter);
  }
  
  // Cập nhật tổng số trận
  totalSpan.textContent = `${filteredMatches.length} trận`;
  
  // Render bảng
  tbody.innerHTML = "";
  
  if (!filteredMatches.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="dim">(không có trận đấu nào)</td></tr>`;
    return;
  }
  
  filteredMatches.forEach((match, idx) => {
    const tr = createEl("tr");
    
    // Format tỉ số với màu sắc
    const scoreDisplay = `${match.homeScore} - ${match.awayScore}`;
    const isHomeWin = match.homeScore > match.awayScore;
    const isAwayWin = match.homeScore < match.awayScore;
    
    let scoreClass = "";
    if (isHomeWin) scoreClass = 'style="color: var(--accent); font-weight: 600;"';
    else if (isAwayWin) scoreClass = 'style="color: #ff6b6b; font-weight: 600;"';
    
    tr.innerHTML = `
      <td>${match.time}</td>
      <td>${match.group}</td>
      <td>${match.homeTeam}</td>
      <td ${scoreClass}>${scoreDisplay}</td>
      <td>${match.awayTeam}</td>
      <td>
        <button class="btn small ghost" onclick="showMatchDetail('${match.matchFile}')" style="padding: 4px 8px; font-size: 11px;">
          📋 Xem
        </button>
      </td>
    `;
    
    tbody.appendChild(tr);
  });
}

// ===== Hàm hiển thị chi tiết trận đấu =====
window.showMatchDetail = function(matchFile) {
  const match = allMatchesHistory.find(m => m.matchFile === matchFile);
  if (!match) return;
  
  const d = match.details;
  const goals = Array.isArray(d.goals) ? d.goals : [];
  const cards = Array.isArray(d.cards) ? d.cards : [];
  
  // Tạo popup đơn giản
  const popup = document.createElement('div');
  popup.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--bg-card);
    border: 2px solid var(--accent);
    border-radius: var(--radius);
    padding: 24px;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
    z-index: 100000;
    box-shadow: 0 30px 60px rgba(0,0,0,0.8);
  `;
  
  // Nút đóng
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `
    position: absolute;
    top: 12px;
    right: 12px;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 20px;
    cursor: pointer;
  `;
  closeBtn.onclick = () => document.body.removeChild(popup);
  
  // Nội dung chi tiết
let goalsHtml = '';
goals.forEach(g => {
  // Kiểm tra nếu là phản lưới
  const typeStr = (g.type || "").toLowerCase();
  const isOwn = g.ownGoal === true || typeStr === "own" || typeStr === "phản lưới";
  
  // Thêm chú thích (phản lưới) nếu là own goal
  const ownNote = isOwn ? ' (phản lưới)' : '';
  
  goalsHtml += `<div style="margin: 4px 0">⚽ ${g.playerName} (${g.teamName}) - phút ${g.minute || '?'}${ownNote}</div>`;
});
  
  let cardsHtml = '';
  cards.forEach(c => {
    const cardEmoji = c.cardType?.toLowerCase().includes('vàng') ? '🟨' : '🟥';
    cardsHtml += `<div style="margin: 4px 0">${cardEmoji} ${c.playerName} (${c.teamName}) - phút ${c.minute || '?'}</div>`;
  });
  
  popup.innerHTML = `
  <h3 style="color: var(--accent); margin-bottom: 16px; padding-right: 24px;">
    ${match.homeTeam} ${match.homeScore} - ${match.awayScore} ${match.awayTeam}
  </h3>
  <div style="margin-bottom: 16px; color: var(--text-dim);">
    Thời gian: ${match.time}<br>
    Bảng: ${match.group}
  </div>
  
  <h4 style="color: var(--text-main); margin: 16px 0 8px;">⚽ Bàn thắng</h4>
  <div style="background: var(--bg-card-alt); padding: 12px; border-radius: var(--radius-sm);">
    ${goalsHtml || '<div class="dim">(không có bàn thắng)</div>'}
  </div>
  
  <h4 style="color: var(--text-main); margin: 16px 0 8px;">🟨🟥 Thẻ phạt</h4>
  <div style="background: var(--bg-card-alt); padding: 12px; border-radius: var(--radius-sm);">
    ${cardsHtml || '<div class="dim">(không có thẻ phạt)</div>'}
  </div>
`;
  
  popup.appendChild(closeBtn);
  document.body.appendChild(popup);
  
  // Click outside để đóng
  setTimeout(() => {
    window.addEventListener('click', function onClick(e) {
      if (!popup.contains(e.target)) {
        document.body.removeChild(popup);
        window.removeEventListener('click', onClick);
      }
    });
  }, 100);
}

// ===== Cập nhật filter dropdowns cho lịch sử =====
function updateMatchFilters() {
  // Filter đội
  const teamSelect = $("#matchFilterTeam");
  const currentTeam = teamSelect.value;
  teamSelect.innerHTML = '<option value="">-- Tất cả đội --</option>';
  
  const sortedTeams = [...allTeamNames].sort((a,b) => a.localeCompare(b, 'vi'));
  sortedTeams.forEach(team => {
    const option = new Option(team, team);
    teamSelect.appendChild(option);
  });
  teamSelect.value = currentTeam && sortedTeams.includes(currentTeam) ? currentTeam : '';
  
  // Filter bảng
  const groupSelect = $("#matchFilterGroup");
  const currentGroup = groupSelect.value;
  groupSelect.innerHTML = '<option value="">-- Tất cả bảng --</option>';
  
  const groups = [...new Set(groupsList.map(g => g.groupName))].sort();
  groups.forEach(group => {
    const option = new Option(group, group);
    groupSelect.appendChild(option);
  });
  groupSelect.value = currentGroup && groups.includes(currentGroup) ? currentGroup : '';
  
  // Render lại nếu có thay đổi
  renderMatchesHistory();
}

// ===== main load sequence =====
async function loadAndRenderAll(){
  await loadTeamsJson();          // đọc teams.json -> buildGroupsAndMap()
  await loadMatchesFromIndex();   // đọc index.json & từng file summary

  const {standingsByGroup, scorersArr, cardsAggArr} = computeAllStats();

  renderStandings(standingsByGroup);
  renderScorers(scorersArr);
  renderCardsAgg(cardsAggArr);

  fillTeamFilterDropdown();
  renderTeamCardDetail();
  
  // Thêm phần render lịch sử
  updateMatchFilters();
  renderMatchesHistory();

  toast("Đã nạp & tính toán BXH");
}

// ===== init bindings =====
function bindUI(){
  $("#btnReload").addEventListener("click",()=>{
    loadAndRenderAll();
  });

  // Xoá data tạm trong RAM (chỉ để debug)
  $("#btnClearTemp").addEventListener("click",()=>{
    teamsData=null;
    groupsList=[];
    teamToGroup={};
    allTeamNames=[];
    allMatches=[];
    cardDetailsMap={};
    teamCardsMap={};
    allMatchesHistory=[];

    $("#standingsWrap").innerHTML=`<div class="dim smalltxt">(đã xoá dữ liệu tạm thời)</div>`;
    $("#scorerTbody").innerHTML=`<tr><td colspan="4" class="dim">(không có dữ liệu)</td></tr>`;
    $("#cardsAggTbody").innerHTML=`<tr><td colspan="5" class="dim">(không có dữ liệu)</td></tr>`;
    $("#teamFilterSelect").innerHTML=`<option value="">-- Chọn đội --</option>`;
    $("#teamCardsDetailTbody").innerHTML=`<tr><td colspan="5" class="dim">(chọn đội để xem)</td></tr>`;
    $("#teamCardTotals").textContent="Vàng: 0 · Đỏ: 0";
    $("#matchCountLabel").textContent="(0 trận đã nạp)";
    
    // Clear phần lịch sử
    $("#matchesHistoryTbody").innerHTML=`<tr><td colspan="6" class="dim">(đã xoá dữ liệu)</td></tr>`;
    $("#matchFilterTeam").innerHTML='<option value="">-- Tất cả đội --</option>';
    $("#matchFilterGroup").innerHTML='<option value="">-- Tất cả bảng --</option>';
    $("#totalMatchesCount").textContent="0 trận";
    
    toast("Đã xoá tạm bộ nhớ (RAM)");
  });

  $("#teamFilterSelect").addEventListener("change",renderTeamCardDetail);
  
  // Thêm event listeners cho filter lịch sử
  $("#matchFilterTeam").addEventListener("change", renderMatchesHistory);
  $("#matchFilterGroup").addEventListener("change", renderMatchesHistory);
}

document.addEventListener("DOMContentLoaded",()=>{
  bindUI();
  loadAndRenderAll();
});
