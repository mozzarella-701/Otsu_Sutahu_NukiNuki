(() => {
  const cfg = window.APP_CONFIG || {};
  const ready = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    !cfg.SUPABASE_ANON_KEY.includes("YOUR_PUBLIC");
  const $ = id => document.getElementById(id);
  let client = null, isAdmin = false, currentUser = null;

  function message(id, text) { $(id).textContent = text || ""; }
  function showLogin() {
    $("loginPanel").hidden = false;
    $("appPanel").hidden = true;
    $("roleBadge").textContent = "未ログイン";
  }
  async function init() {
    if (!ready || !window.supabase) {
      message("loginMessage", "Supabase設定がまだありません。config.jsを作成して接続情報を設定してください。");
      return;
    }
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const { data } = await client.auth.getSession();
    if (data.session) await enterApp(data.session.user);
    else showLogin();
    client.auth.onAuthStateChange((_event, session) => {
      if (session) enterApp(session.user);
      else showLogin();
    });
  }
  async function enterApp(user) {
    currentUser = user;
    const { data: profile, error } = await client.from("profiles")
      .select("role, disabled").eq("id", user.id).maybeSingle();
    if (error || !profile || profile.disabled) {
      await client.auth.signOut();
      message("loginMessage", "アカウント情報を確認できません。管理者に確認してください。");
      return;
    }
    isAdmin = profile.role === "admin";
    $("roleBadge").textContent = isAdmin ? "管理者" : "閲覧者";
    $("loginPanel").hidden = true;
    $("appPanel").hidden = false;
    $("adminForm").hidden = !isAdmin;
    await loadRecords();
  }
  async function loadRecords() {
    message("listMessage", "読み込み中…");
    const { data, error } = await client.from("records").select("*").order("created_at", {ascending:false});
    if (error) { message("listMessage", "一覧を読み込めませんでした。"); return; }
    const root = $("records"); root.replaceChildren();
    const rows = (data || []).filter(r => !$("uncollectedOnly").checked || !r.completed);
    if (!rows.length) {
      message("listMessage", "表示する記録はありません。");
      return;
    }
    message("listMessage", "");
    rows.forEach(r => {
      const card = document.createElement("article"); card.className = "record";
      const title = document.createElement("h3"); title.textContent = r.title;
      const category = document.createElement("p"); category.textContent = r.category || "分類なし";
      const note = document.createElement("p"); note.textContent = r.note || "";
      const status = document.createElement("p"); status.className = "meta";
      status.textContent = r.completed ? "完了" : "未完了";
      card.append(title, category, note, status);
      if (isAdmin) {
        const actions = document.createElement("div"); actions.className = "record-actions";
        const toggle = document.createElement("button"); toggle.className = "done";
        toggle.textContent = r.completed ? "未完了に戻す" : "完了にする";
        toggle.onclick = async () => {
          const { error } = await client.from("records").update({completed:!r.completed}).eq("id",r.id);
          if (error) alert("更新できませんでした。"); else loadRecords();
        };
        const del = document.createElement("button"); del.className = "delete"; del.textContent = "削除";
        del.onclick = async () => {
          if (!confirm("この記録を削除しますか？")) return;
          const { error } = await client.from("records").delete().eq("id",r.id);
          if (error) alert("削除できませんでした。"); else loadRecords();
        };
        actions.append(toggle,del); card.append(actions);
      }
      root.append(card);
    });
  }
 $("loginBtn").addEventListener("click", async () => {
    if (!client) {
      message("loginMessage", "先にSupabase設定が必要です。");
      return;
    }

    message("loginMessage", "ログイン中…");

    const { error } = await client.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });

    if (error) {
      console.error("ログインエラー:", error);
      message("loginMessage", "ログイン失敗：" + error.message);
    } else {
      message("loginMessage", "");
    }
});
  });
  $("logoutBtn").addEventListener("click", () => client.auth.signOut());
  $("addBtn").addEventListener("click", async () => {
    const title = $("recordTitle").value.trim();
    if (!title) { message("adminMessage","記録名を入力してください。"); return; }
    const { error } = await client.from("records").insert({
      title, category:$("recordCategory").value.trim(),
      note:$("recordNote").value.trim(), created_by:currentUser.id
    });
    if (error) message("adminMessage","追加できませんでした。");
    else {
      $("recordTitle").value = ""; $("recordCategory").value = ""; $("recordNote").value = "";
      message("adminMessage","追加しました。"); await loadRecords();
    }
  });
  $("refreshBtn").addEventListener("click",loadRecords);
  $("uncollectedOnly").addEventListener("change",loadRecords);
  init();
})();
