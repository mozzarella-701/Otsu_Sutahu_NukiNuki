
(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = id => document.getElementById(id);

  let client = null;
  let currentUser = null;
  let isAdmin = false;
  let entering = false;

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

    const rows = (data || []).filter(
      r => !$("uncollectedOnly").checked || !r.completed
    );

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
  $("refreshUsersBtn").addEventListener("click", loadUsers);

  init();
})();
