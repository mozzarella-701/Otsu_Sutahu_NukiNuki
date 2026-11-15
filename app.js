
(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = id => document.getElementById(id);

  let client = null;
  let currentUser = null;
  let isAdmin = false;
  let entering = false;

  
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

      await loadRecords();

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

    const keyword = ($("recordSearch")?.value || "").trim().toLocaleLowerCase("ja");
    const rows = (data || []).filter(r => {
      const statusMatches = !$("uncollectedOnly").checked || !r.completed;
      const text = [r.title, r.category, r.note].filter(Boolean).join(" ").toLocaleLowerCase("ja");
      return statusMatches && (!keyword || text.includes(keyword));
    });

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
  $("refreshUsersBtn").addEventListener("click", loadUsers);
const locationBtn = $("locationBtn");
if (locationBtn) {
  locationBtn.addEventListener("click", findNearestStation);
}
setupManualStation();

  init();
})();