
(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = id => document.getElementById(id);

  let client = null;
  let currentUser = null;
  let isAdmin = false;
  let entering = false;
  let pendingTimetable = null;
  let currentTimetable = [];
  let currentTimetableStations = [];

  
  let otsuStations = null;

  // 大津線の駅名
  const otsuStationNames = [
    "石山寺", "唐橋前", "京阪石山", "粟津", "瓦ヶ浜",
    "中ノ庄", "膳所本町", "錦", "京阪膳所", "石場",
    "島ノ関", "びわ湖浜大津", "三井寺", "大津市役所前",
    "京阪大津京", "近江神宮前", "南滋賀", "滋賀里",
    "穴太", "松ノ馬場", "坂本比叡山口",
        "京阪山科", "四宮", "追分", "大谷", "上栄町"
  ];

  // oudの駅名とサイトの駅名の違いを吸収
  const stationAlias = {
    "びわ湖浜大津": ["浜大津", "浜大津（京津）"],
    "大津市役所前": ["別所"],
    "京阪大津京": ["皇子山"],
    "坂本比叡山口": ["坂本"]
  };
  const sameStation = (callName, selected) =>
    callName === selected || (stationAlias[selected] || []).includes(callName);

  // 2地点間の距離を計算（km）
  function distanceKm(lat1, lon1, lat2, lon2) {
    const rad = d => d * Math.PI / 180;
    const R = 6371;

    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // 公開地図データから大津線の駅位置を取得

async function loadOtsuStations() {
  if (otsuStations) return otsuStations;

  const cacheKey = "otsu_station_cache_v1";
  const cacheDays = 30;

  // 保存済みの駅データを確認
  try {
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      const saved = JSON.parse(cached);
      const age = Date.now() - saved.savedAt;
      const limit = cacheDays * 24 * 60 * 60 * 1000;

      if (
        Array.isArray(saved.stations) &&
        saved.stations.length > 0 &&
        age < limit
      ) {
        otsuStations = saved.stations;
        return otsuStations;
      }
    }
  } catch (error) {
    console.warn("駅データの保存情報を読み込めませんでした。", error);
  }

  // 保存データがない場合は外部から取得
  const query = `
    [out:json][timeout:25];
    (
      node["railway"~"^(station|halt|tram_stop)$"]
        (34.93,135.78,35.12,135.95);
      way["railway"~"^(station|halt|tram_stop)$"]
        (34.93,135.78,35.12,135.95);
    );
    out center tags;
  `;

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ];

  let lastError;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: "data=" + encodeURIComponent(query)
      });

      if (!response.ok) {
        throw new Error("駅データを取得できませんでした。");
      }

      const result = await response.json();
      const allowed = new Set(otsuStationNames);

      const stations = (result.elements || [])
        .map(item => {
          const name = item.tags?.name || item.tags?.["name:ja"];
          const lat = item.lat ?? item.center?.lat;
          const lon = item.lon ?? item.center?.lon;

          return { name, lat, lon };
        })
        .filter(s =>
          allowed.has(s.name) &&
          Number.isFinite(s.lat) &&
          Number.isFinite(s.lon)
        );

      if (!stations.length) {
        throw new Error("駅の位置情報が見つかりませんでした。");
      }

      otsuStations = stations;

      // 次回用に駅データを保存
      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          savedAt: Date.now(),
          stations
        }));
      } catch (error) {
        console.warn("駅データを保存できませんでした。", error);
      }

      return stations;

    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("駅データを取得できませんでした。");
}


   

  // 現在地から最寄り駅を調べる
  async function findNearestStation() {
    const button = $("locationBtn");
    button.disabled = true;
    message("locationMessage", "現在地を取得しています…");

    try {
      if (!navigator.geolocation) {
        throw new Error("このブラウザでは位置情報を利用できません。");
      }

      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: false,
            timeout: 15000,
            maximumAge: 60000
          }
        );
      });

      message("locationMessage", "最寄り駅を調べています…");

      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      const stations = await loadOtsuStations();

      let nearest = null;

      for (const station of stations) {
        const distance = distanceKm(
          lat, lon, station.lat, station.lon
        );

        if (!nearest || distance < nearest.distance) {
          nearest = {
            name: station.name,
            distance
          };
        }
      }

      if (!nearest) {
        throw new Error("最寄り駅を特定できませんでした。");
      }

      const stationSelect = $("manualStation");
      if (stationSelect) stationSelect.value = nearest.name;
      const timetableSelect = $("timetableStation");
      if (timetableSelect) timetableSelect.value = nearest.name;
      renderNextDepartures();
      message(
        "locationMessage",
        "最寄り駅： " + nearest.name + "駅\n" +
        "直線距離：約" + nearest.distance.toFixed(2) + " km"
      );
      message("manualStationMessage", "現在地から判定した駅を選択中です。");

    } catch (error) {
      let text = "位置情報を取得できませんでした。";

      if (error.code === 1) {
        text = "位置情報の使用が許可されていません。Safariのサイト設定を確認してください。";
      } else if (error.code === 2) {
        text = "現在地を取得できませんでした。";
      } else if (error.code === 3) {
        text = "位置情報の取得がタイムアウトしました。";
      } else if (error.message) {
        text = error.message;
      }

      message("locationMessage", text);
      console.error(error);

    } finally {
      button.disabled = false;
    }
  }



  // 手動選択用の駅一覧を作成（選択内容は端末・DBへ保存しない）
  function setupManualStation() {
    const select = $("manualStation");
    if (!select) return;
    for (const name of otsuStationNames) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name + "駅";
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      if (!select.value) {
        message("manualStationMessage", "駅を選択してください。");
        return;
      }
      message("locationMessage", "選択した駅： " + select.value + "駅\n手動で選択しています。");
      message("manualStationMessage", "手動選択した駅を表示中です。現在地から再取得するとGPS判定に戻ります。");
      const timetableSelect = $("timetableStation");
      if (timetableSelect) timetableSelect.value = select.value;
      renderNextDepartures();
    });
  }

  const ready =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    !cfg.SUPABASE_ANON_KEY.includes("YOUR_PUBLIC");

  function message(id, text) {
    $(id).textContent = text || "";
  }

  function hideAll() {
    ["loginPanel", "pendingPanel", "disabledPanel", "appPanel"]
      .forEach(id => $(id).hidden = true);
  }

  function showLogin(text = "") {
    hideAll();
    $("loginPanel").hidden = false;
    $("roleBadge").textContent = "未ログイン";
    message("loginMessage", text);
  }

  function showPending() {
    hideAll();
    $("pendingPanel").hidden = false;
    $("roleBadge").textContent = "承認待ち";
  }

  function showDisabled() {
    hideAll();
    $("disabledPanel").hidden = false;
    $("roleBadge").textContent = "利用停止";
  }

  async function logout() {
    if (client) await client.auth.signOut();
  }

  async function enterApp(user) {
    if (entering) return;
    entering = true;

    try {
      currentUser = user;

      const { data: profile, error } = await client
        .from("profiles")
        .select("role, approved, disabled, email")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        showLogin("アカウント情報を確認できません。再度お試しください。");
        console.error(error);
        return;
      }

      if (!profile) {
        showLogin("アカウント登録を確認できません。管理者にお問い合わせください。");
        return;
      }

      if (profile.disabled) {
        showDisabled();
        return;
      }

      if (!profile.approved) {
        showPending();
        return;
      }

      isAdmin = profile.role === "admin";

      hideAll();
      $("appPanel").hidden = false;
      $("roleBadge").textContent = isAdmin ? "管理者" : "閲覧者";
      $("userEmail").textContent = profile.email || user.email || "";

      $("adminForm").hidden = !isAdmin;
      $("userManagement").hidden = !isAdmin;
      $("exportTools").hidden = !isAdmin;
      $("timetableAdminTools").hidden = !isAdmin;

      await loadRecords();
      await loadPublicTimetable();

      if (isAdmin) await loadUsers();

    } finally {
      entering = false;
    }
  }

  async function loadRecords() {
    message("listMessage", "読み込み中…");

    const { data, error } = await client
      .from("records")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      message("listMessage", "一覧を読み込めませんでした。");
      console.error(error);
      return;
    }

    const root = $("records");
    root.replaceChildren();

    const allRows = data || [];
    const totalCount = allRows.length;
    const completedCount = allRows.filter(r => r.completed).length;
    const pendingCount = totalCount - completedCount;
    const keyword = ($("recordSearch")?.value || "").trim().toLocaleLowerCase("ja");
    const rows = allRows.filter(r => {
      const statusMatches = !$("uncollectedOnly").checked || !r.completed;
      const text = [r.title, r.category, r.note].filter(Boolean).join(" ").toLocaleLowerCase("ja");
      return statusMatches && (!keyword || text.includes(keyword));
    });
    const summary = $("recordSummary");
    if (summary) {
      summary.textContent = `全${totalCount}件 ／ 未完了${pendingCount}件 ／ 完了${completedCount}件　・　表示中${rows.length}件`;
    }

    if (!rows.length) {
      message("listMessage", "表示する記録はありません。");
      return;
    }

    message("listMessage", "");

    rows.forEach(r => {
      const card = document.createElement("article");
      card.className = "record";

      const title = document.createElement("h3");
      title.textContent = r.title;

      const category = document.createElement("p");
      category.textContent = r.category || "分類なし";

      const note = document.createElement("p");
      note.textContent = r.note || "";

      const status = document.createElement("p");
      status.className = "meta";
      status.textContent = r.completed ? "完了" : "未完了";

      card.append(title, category, note, status);

      if (isAdmin) {
        const actions = document.createElement("div");
        actions.className = "record-actions";

        const toggle = document.createElement("button");
        toggle.className = "done";
        toggle.textContent = r.completed ? "未完了に戻す" : "完了にする";

        toggle.onclick = async () => {
          const { error } = await client
            .from("records")
            .update({ completed: !r.completed })
            .eq("id", r.id);

          if (error) alert("更新できませんでした。");
          else await loadRecords();
        };

        const del = document.createElement("button");
        del.className = "delete";
        del.textContent = "削除";

        del.onclick = async () => {
          if (!confirm("この記録を削除しますか？")) return;

          const { error } = await client
            .from("records")
            .delete()
            .eq("id", r.id);

          if (error) alert("削除できませんでした。");
          else await loadRecords();
        };

        actions.append(toggle, del);
        card.append(actions);
      }

      root.append(card);
    });
  }


  // OuDia 1.00 / 1.02 を解析する。備考欄（Bikou）は〔回収:済〕の有無だけを読み取り、他の内容は保存しない。
  function parseOuDiaTree(lines) {
    let pos = 0;
    const readBlock = name => {
      const node = { name, props: [], kids: [] };
      while (pos < lines.length) {
        const line = lines[pos++];
        if (line === ".") return node;
        if (!line.includes("=") && line.endsWith(".")) node.kids.push(readBlock(line.slice(0, -1)));
        else {
          const k = line.indexOf("=");
          node.props.push(k < 0 ? [line, ""] : [line.slice(0, k), line.slice(k + 1)]);
        }
      }
      return node;
    };
    const root = { name: "", props: [], kids: [] };
    while (pos < lines.length) {
      const line = lines[pos++];
      if (!line) continue;
      if (!line.includes("=") && line.endsWith(".")) root.kids.push(readBlock(line.slice(0, -1)));
      else {
        const k = line.indexOf("=");
        root.props.push(k < 0 ? [line, ""] : [line.slice(0, k), line.slice(k + 1)]);
      }
    }
    return root;
  }

  function parseOuDiaTime(value) {
    let v = String(value || "").replace(/[：:\s]/g, "");
    if (!/^\d{3,6}$/.test(v)) return null;
    if (v.length === 3 || v.length === 5) v = "0" + v;
    const hh = Number(v.slice(0, 2));
    const mm = Number(v.slice(2, 4));
    const ss = v.length === 6 ? Number(v.slice(4, 6)) : 0;
    if (mm > 59 || ss > 59) return null;
    return { minutes: (hh < 3 ? hh + 24 : hh) * 60 + mm + ss / 60, text: `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}` };
  }

  function parseOuDiaCell(raw) {
    if (!raw || raw === "0") return null;
    const semi = raw.indexOf(";");
    const body = semi < 0 ? "" : raw.slice(semi + 1);
    const timePart = body.split("$")[0];
    let arrival = null, departure = null;
    if (timePart.includes("/")) {
      const [a, d] = timePart.split("/");
      arrival = a ? parseOuDiaTime(a) : null;
      departure = d ? parseOuDiaTime(d) : null;
    } else if (timePart) {
      departure = parseOuDiaTime(timePart);
    }
    if (!arrival && !departure) return null;
    return { arrival, departure };
  }

  function parseOuDiaText(text) {
    const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
    if (!lines.some(x => x === "FileType=OuDia.1.02" || x === "FileType=OuDia.1.00")) throw new Error("OuDia 1.00 / 1.02形式ではありません。");
    const root = parseOuDiaTree(lines);
    const rosen = root.kids.find(x => x.name === "Rosen");
    if (!rosen) throw new Error("路線情報（Rosen）が見つかりません。");
    const stations = rosen.kids.filter(x => x.name === "Eki").map(x => {
      const prop = x.props.find(p => p[0] === "Ekimei");
      return prop ? prop[1] : "";
    }).filter(Boolean);
    if (stations.length < 2) throw new Error("駅情報を読み取れませんでした。");

    const schedules = [];
    const dias = rosen.kids.filter(x => x.name === "Dia");
    for (const dia of dias) {
      const nameProp = dia.props.find(p => p[0] === "DiaName");
      const diaName = nameProp?.[1] || "ダイヤ";
      for (const dirBlock of dia.kids.filter(x => x.name === "Kudari" || x.name === "Nobori")) {
        const direction = dirBlock.name === "Kudari" ? "下り" : "上り";
        const reverse = dirBlock.name === "Nobori";
        for (const train of dirBlock.kids.filter(x => x.name === "Ressya")) {
          const get = key => train.props.find(p => p[0] === key)?.[1] || "";
          const trainNo = get("Ressyabangou").trim();
          const cells = get("EkiJikoku").split(",");
          if (!trainNo || !cells.length) continue;
          const calls = [];
          for (let i = 0; i < stations.length; i++) {
            const sourceIndex = reverse ? stations.length - 1 - i : i;
            const cell = parseOuDiaCell(cells[sourceIndex] || "0");
            if (!cell) continue;
            const arrival = cell.arrival?.text || "";
            const departure = cell.departure?.text || "";
            const sortTime = cell.departure?.minutes ?? cell.arrival?.minutes;
            calls.push({ station: stations[i], time: departure || arrival, arrival, departure, sortTime });
          }
          if (calls.length) schedules.push({ diagram: diaName, direction, trainNo, collected, calls });
       }
      }
    }
    if (!schedules.length) throw new Error("列車時刻を読み取れませんでした。EkiJikokuの形式を確認してください。");
    return { stations, schedules, diagramNames: [...new Set(schedules.map(x => x.diagram))] };
  }

  function compareTimetables(nextSchedules) {
    const oldRows = currentTimetable || [];
    const key = t => `${t.diagram}|${t.direction}|${t.trainNo}`;
    const oldMap = new Map(oldRows.map(t => [key(t), JSON.stringify([!!t.collected, t.calls || []])]));
    const newMap = new Map(nextSchedules.map(t => [key(t), JSON.stringify([!!t.collected, t.calls || []])]));
    let added = 0, removed = 0, changed = 0;
    for (const [k, v] of newMap) {
      if (!oldMap.has(k)) added++;
      else if (oldMap.get(k) !== v) changed++;
    }
    for (const k of oldMap.keys()) if (!newMap.has(k)) removed++;
    return { added, removed, changed, unchanged: Math.max(0, nextSchedules.length - added - changed) };
  }

  function setupTimetableStationOptions() {
    const select = $("timetableStation");
    if (!select) return;
    select.replaceChildren(new Option("駅を選択してください", ""));
    for (const name of currentTimetableStations) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name + "駅";
      select.appendChild(option);
    }
  }

  function renderTimetable() {
    const root = $("timetableRows");
    if (!root) return;
    root.replaceChildren();
    const station = $("timetableStation").value;
    const keyword = ($("timetableSearch").value || "").trim().toLocaleLowerCase("ja");
    let rows = currentTimetable.filter(t => !t.collected);
    const uncollectedTotal = rows.length;
    if (station) rows = rows.map(t => ({...t, calls:t.calls.filter(c => sameStation(c.station, station))})).filter(t => t.calls.length);
    if (keyword) rows = rows.filter(t => `${t.trainNo} ${t.diagram} ${t.calls.map(c => `${c.station} ${c.time}`).join(" ")}`.toLocaleLowerCase("ja").includes(keyword));
    $("timetableSummary").textContent = `未回収スタフの列車：${uncollectedTotal}列車（全${currentTimetable.length}列車中）／ 表示${rows.length}列車`;
    if (!rows.length) {
      const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = currentTimetable.length ? "条件に一致する列車はありません。" : "時刻表データはまだ登録されていません。"; root.append(empty); return;
    }
    rows.slice(0, 150).forEach(t => {
      const card = document.createElement("article"); card.className = "record";
      const title = document.createElement("h3"); title.textContent = `${t.trainNo}　${t.direction}`;
      const meta = document.createElement("p"); meta.className = "meta"; meta.textContent = t.diagram;
      const times = document.createElement("p"); times.textContent = t.calls.map(c => `${c.station} ${c.arrival && c.departure ? `${c.arrival}/${c.departure}` : (c.departure || c.arrival || c.time)}`).join("　→　");
      card.append(title, meta, times); root.append(card);
    });
    if (rows.length > 150) {
      const more = document.createElement("p"); more.className = "muted"; more.textContent = "表示件数が150列車を超えるため、駅や検索条件で絞り込んでください。"; root.append(more);
    }
  }


  function showTrainDetail(train) {
    const panel = $("trainDetailPanel");
    const title = $("trainDetailTitle");
    const destination = $("trainDetailDestination");
    const rowsRoot = $("trainDetailRows");
    if (!panel || !rowsRoot) return;

    const calls = [...(train.calls || [])].sort((a, b) =>
      (Number.isFinite(a.sortTime) ? a.sortTime : 999999) -
      (Number.isFinite(b.sortTime) ? b.sortTime : 999999)
    );
    const terminal = calls.length ? calls[calls.length - 1].station : "行き先不明";
    title.textContent = `${train.trainNo}　${train.direction}`;
    destination.textContent = `行き先：${terminal} ／ ${train.diagram || ""}`;
    rowsRoot.replaceChildren();

    calls.forEach((call, index) => {
      const row = document.createElement("div");
      row.className = "train-detail-row";
      const station = document.createElement("strong");
      station.textContent = `${index + 1}. ${call.station}`;
      const times = document.createElement("span");
      const parts = [];
      if (call.arrival) parts.push(`着 ${call.arrival}`);
      if (call.departure) parts.push(`発 ${call.departure}`);
      times.textContent = parts.join("　") || call.time || "時刻なし";
      row.append(station, times);
      rowsRoot.append(row);
    });
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // 公開時刻表から、選択駅の次発列車を方向別に最大3件表示
  function renderNextDepartures() {
    const station = $("manualStation")?.value || "";
    const stationLabel = $("nextDeparturesStation");
    const northRoot = $("nextSakamoto");
    const southRoot = $("nextIshiyama");
    if (!stationLabel || !northRoot || !southRoot) return;

    stationLabel.textContent = station
      ? `基準駅：${station}駅 ／ 現在時刻：${new Date().toLocaleTimeString("ja-JP", {hour:"2-digit", minute:"2-digit"})}`
      : "現在地から最寄駅を取得してください。";

    northRoot.replaceChildren();
    southRoot.replaceChildren();
    if (!station) {
      for (const root of [northRoot, southRoot]) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "最寄駅を取得すると表示します。";
        root.append(p);
      }
      return;
    }
    if (!currentTimetable.length) {
      for (const root of [northRoot, southRoot]) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "公開時刻表がまだ読み込まれていません。";
        root.append(p);
      }
      return;
    }

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const groups = { north: [], south: [] };
    // 土日祝相当は土休日ダイヤ、平日は平日ダイヤを優先
    // 「学休期」は学校休業日の判定情報がないため、自動選択せず平日扱い
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    const wantedDiagram = isWeekend ? "土休日" : "平日";
    const dayRows = currentTimetable.filter(t => String(t.diagram || "").includes(wantedDiagram));
    const timetableRows = dayRows.length ? dayRows : currentTimetable;

    for (const train of timetableRows) {
      if (train.collected) continue;
      const call = (train.calls || []).find(c => sameStation(c.station, station));
      if (!call) continue;
      const rawTime = call.departure || call.time || call.arrival || "";
      const match = String(rawTime).match(/^(\d{1,2}):(\d{2})$/);
      if (!match) continue;
      let minutes = Number(match[1]) * 60 + Number(match[2]);
      // OuDiaの深夜帯（24時以降）表記を現在時刻と比較できるようにする
      if (minutes < 180 && nowMinutes >= 180) minutes += 1440;
      if (minutes < nowMinutes) continue;

      // OuDiaの方向区分に従って2方面に分ける
      const key = train.direction === "下り" ? "north" : "south";
      groups[key].push({ train, time: rawTime, minutes });
    }

    for (const [key, root] of [["north", northRoot], ["south", southRoot]]) {
      const rows = groups[key].sort((a,b) => a.minutes - b.minutes).slice(0,3);
      if (!rows.length) {
        const p = document.createElement("p");
        p.className = "muted";
p.textContent = "この先の未回収スタフの列車はありません。";
        root.append(p);
        continue;
      }
      for (const row of rows) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "next-departure-card next-departure-button";
        const time = document.createElement("strong");
        time.className = "next-departure-time";
        time.textContent = row.time;
        const train = document.createElement("span");
        train.className = "next-departure-train";
        train.textContent = `${row.train.trainNo}　${row.train.direction}`;
        const orderedCalls = [...(row.train.calls || [])].sort((a, b) =>
          (Number.isFinite(a.sortTime) ? a.sortTime : 999999) -
          (Number.isFinite(b.sortTime) ? b.sortTime : 999999)
        );
        const destination = orderedCalls.length ? orderedCalls[orderedCalls.length - 1].station : "行き先不明";
        const dest = document.createElement("span");
        dest.className = "next-departure-destination";
        dest.textContent = `行き先：${destination}`;
        const diagram = document.createElement("span");
        diagram.className = "next-departure-meta";
        diagram.textContent = `${row.train.diagram || ""} ・ 全駅時刻表を見る`;
        card.append(time, train, dest, diagram);
        card.addEventListener("click", () => showTrainDetail(row.train));
        root.append(card);
      }
    }
  }

  async function loadPublicTimetable() {
    const { data, error } = await client.from("public_timetable").select("data, source_filename, imported_at").eq("id", 1).maybeSingle();
    if (error) {
      $("timetableSummary").textContent = "時刻表テーブル未設定です。管理者は同梱SQLをSupabaseで1回実行してください。";
      console.warn(error);
      return;
    }
    currentTimetable = data?.data?.schedules || [];
    currentTimetableStations = data?.data?.stations || [];
    setupTimetableStationOptions();
    renderTimetable();
    renderNextDepartures();
    if (data?.source_filename) {
      const date = data.imported_at ? new Date(data.imported_at).toLocaleString("ja-JP") : "";
      $("timetableSummary").textContent += ` ／ ${data.source_filename} ${date ? "（" + date + "反映）" : ""}`;
    }
  }

  async function previewOuDia() {
    if (!isAdmin) return;
    const file = $("oudFile").files?.[0];
    if (!file) { message("oudMessage", ".oudファイルを選択してください。"); return; }
    message("oudMessage", "解析中…");
    $("applyOudBtn").hidden = true;
    try {
      const buffer = await file.arrayBuffer();
      let decoded;
      try { decoded = new TextDecoder("shift_jis").decode(buffer); }
      catch { decoded = new TextDecoder("utf-8").decode(buffer); }
      pendingTimetable = parseOuDiaText(decoded);
      pendingTimetable.sourceFilename = file.name;
      const preview = $("oudPreview"); preview.hidden = false; preview.replaceChildren();
      const summary = document.createElement("p"); summary.textContent = `${pendingTimetable.stations.length}駅・${pendingTimetable.schedules.length}列車・${pendingTimetable.diagramNames.length}種類のダイヤを読み取りました。`;
      const names = document.createElement("p"); names.textContent = "ダイヤ：" + pendingTimetable.diagramNames.join("／");
      const diff = compareTimetables(pendingTimetable.schedules);
      const changes = document.createElement("p");
      changes.textContent = `現在の公開時刻表との差分：追加 ${diff.added} ／ 時刻等変更 ${diff.changed} ／ 削除 ${diff.removed} ／ 変更なし ${diff.unchanged}`;
      const sample = document.createElement("p"); sample.textContent = "読み取り例：" + pendingTimetable.schedules.slice(0, 5).map(t => `${t.diagram} ${t.trainNo} ${t.calls[0]?.station || ""} ${t.calls[0]?.time || ""}`).join("、");
      preview.append(summary, names, changes, sample);
      $("applyOudBtn").hidden = false;
      message("oudMessage", "解析できました。内容を確認してから共有データに反映してください。");
    } catch (error) {
      pendingTimetable = null;
      message("oudMessage", error.message || "解析できませんでした。");
      console.error(error);
    }
  }

  async function applyOuDia() {
    if (!isAdmin || !pendingTimetable) return;
    const button = $("applyOudBtn"); button.disabled = true;
    message("oudMessage", "共有データに反映中…");
    try {
      const payload = {
        id: 1,
        source_filename: pendingTimetable.sourceFilename,
        imported_at: new Date().toISOString(),
        imported_by: currentUser.id,
        data: { stations: pendingTimetable.stations, diagramNames: pendingTimetable.diagramNames, schedules: pendingTimetable.schedules }
      };
      const { error } = await client.from("public_timetable").upsert(payload, { onConflict: "id" });
      if (error) throw error;
      message("oudMessage", "反映完了！閲覧者にも公開時刻表が共有されました。");
      $("oudPreview").hidden = true; button.hidden = true; pendingTimetable = null;
      await loadPublicTimetable();
    } catch (error) {
      message("oudMessage", "反映できませんでした。SupabaseのSQL設定と通信状態を確認してください。");
      console.error(error);
    } finally { button.disabled = false; }
  }

  // 管理者向け：全記録をCSVでバックアップ
  function csvCell(value) {
    let text = value == null ? "" : String(value);
    // Excel等で数式として解釈される値を文字列として扱う
    if (/^[\s]*[=+@\-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  async function exportAllRecordsCsv() {
    if (!isAdmin) return;

    const button = $("exportCsvBtn");
    button.disabled = true;
    button.textContent = "出力中…";

    try {
      const { data, error } = await client
        .from("records")
        .select("id, title, category, note, completed, created_at, created_by")
        .order("created_at", { ascending: true });

      if (error) throw error;

      const headers = ["ID", "記録名", "分類", "メモ", "状態", "登録日時", "登録者ID"];
      const lines = [headers, ...(data || []).map(row => [
        row.id,
        row.title,
        row.category,
        row.note,
        row.completed ? "完了" : "未完了",
        row.created_at,
        row.created_by
      ])];
      const csv = "\uFEFF" + lines.map(line => line.map(csvCell).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date();
      const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("");
      link.href = url;
      link.download = `otsu-records-${stamp}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      message("listMessage", `${(data || []).length}件をCSV出力しました。`);
    } catch (error) {
      message("listMessage", "CSVを出力できませんでした。通信状態を確認してください。");
      console.error(error);
    } finally {
      button.disabled = false;
      button.textContent = "全記録をCSV出力";
    }
  }

  async function loadUsers() {
    message("userMessage", "読み込み中…");

    const { data, error } = await client
      .from("profiles")
      .select("id, email, role, approved, disabled")
      .order("created_at", { ascending: true });

    if (error) {
      message("userMessage", "ユーザー一覧を取得できませんでした。");
      console.error(error);
      return;
    }

    const root = $("users");
    root.replaceChildren();

    (data || []).forEach(user => {
      const card = document.createElement("article");
      card.className = "record";

      const email = document.createElement("h3");
      email.textContent = user.email || "メールアドレス不明";

      const status = document.createElement("p");
      status.className = "meta";

      if (user.role === "admin") {
        status.textContent = "管理者";
      } else if (user.disabled) {
        status.textContent = "利用停止中";
      } else if (!user.approved) {
        status.textContent = "承認待ち";
      } else {
        status.textContent = "承認済み・閲覧者";
      }

      card.append(email, status);

      if (user.role !== "admin" && user.id !== currentUser.id) {
        const actions = document.createElement("div");
        actions.className = "record-actions";

        if (!user.approved && !user.disabled) {
          const approve = document.createElement("button");
          approve.textContent = "承認する";
          approve.onclick = () => updateUser(user.id, {
            approved: true
          });
          actions.append(approve);
        }

        if (user.disabled) {
          const enable = document.createElement("button");
          enable.textContent = "利用再開";
          enable.onclick = () => updateUser(user.id, {
            disabled: false
          });
          actions.append(enable);
        } else {
          const disable = document.createElement("button");
          disable.className = "delete";
          disable.textContent = "利用停止";
          disable.onclick = async () => {
            if (!confirm("このユーザーを利用停止にしますか？")) return;
            await updateUser(user.id, { disabled: true });
          };
          actions.append(disable);
        }

        card.append(actions);
      }

      root.append(card);
    });

    message("userMessage", data.length ? "" : "ユーザーはいません。");
  }

  async function updateUser(id, changes) {
    const { error } = await client
      .from("profiles")
      .update(changes)
      .eq("id", id);

    if (error) {
      message("userMessage", "変更できませんでした。");
      console.error(error);
      return;
    }

    message("userMessage", "変更しました。");
    await loadUsers();
  }

  async function init() {
    if (!ready || !window.supabase) {
      showLogin("Supabaseの設定を確認してください。");
      return;
    }

    client = window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_ANON_KEY
    );

    const { data, error } = await client.auth.getSession();

    if (error) {
      showLogin("ログイン状態を確認できませんでした。");
      return;
    }

    if (data.session) {
      await enterApp(data.session.user);
    } else {
      showLogin();
    }

    client.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;

      if (session) {
        setTimeout(() => enterApp(session.user), 0);
      } else {
        currentUser = null;
        isAdmin = false;
        showLogin();
      }
    });
  }

  $("googleLoginBtn").addEventListener("click", async () => {
    if (!client) return;

    message("loginMessage", "Googleログインへ移動します…");

    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });

    if (error) {
      message("loginMessage", "ログインできませんでした。");
      console.error(error);
    }
  });

  $("logoutBtn").addEventListener("click", logout);
  $("pendingLogoutBtn").addEventListener("click", logout);
  $("disabledLogoutBtn").addEventListener("click", logout);

  $("addBtn").addEventListener("click", async () => {
    const title = $("recordTitle").value.trim();

    if (!title) {
      message("adminMessage", "記録名を入力してください。");
      return;
    }

    const { error } = await client.from("records").insert({
      title,
      category: $("recordCategory").value.trim(),
      note: $("recordNote").value.trim(),
      created_by: currentUser.id
    });

    if (error) {
      message("adminMessage", "追加できませんでした。");
      console.error(error);
      return;
    }

    $("recordTitle").value = "";
    $("recordCategory").value = "";
    $("recordNote").value = "";

    message("adminMessage", "追加しました。");
    await loadRecords();
  });

  $("refreshBtn").addEventListener("click", loadRecords);
  $("uncollectedOnly").addEventListener("change", loadRecords);
  $("recordSearch")?.addEventListener("input", loadRecords);
  $("clearFiltersBtn")?.addEventListener("click", () => {
    if ($("recordSearch")) $("recordSearch").value = "";
    if ($("uncollectedOnly")) $("uncollectedOnly").checked = false;
    loadRecords();
  });
  $("refreshUsersBtn").addEventListener("click", loadUsers);
  $("exportCsvBtn")?.addEventListener("click", exportAllRecordsCsv);
const locationBtn = $("locationBtn");
if (locationBtn) {
  locationBtn.addEventListener("click", findNearestStation);
}
  $("previewOudBtn")?.addEventListener("click", previewOuDia);
  $("applyOudBtn")?.addEventListener("click", applyOuDia);
  $("timetableStation")?.addEventListener("change", renderTimetable);
  $("timetableSearch")?.addEventListener("input", renderTimetable);
  setupManualStation();
  $("closeTrainDetailBtn")?.addEventListener("click", () => {
    const panel = $("trainDetailPanel");
    if (panel) panel.hidden = true;
  });
  renderNextDepartures();
  setInterval(renderNextDepartures, 60000);

  init();
})();
