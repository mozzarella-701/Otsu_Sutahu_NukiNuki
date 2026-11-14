# 大津線 記録管理Webアプリ（初期セット）

このフォルダは GitHub Pages + Supabase で動かすための初期ひな形です。

## できること（初期版）
- メールアドレスとパスワードでログイン
- 登録済みの記録一覧を表示
- 管理者だけが記録を追加・編集・削除
- 友達アカウントは閲覧のみ
- データはSupabaseに保存し、端末間で共有

## 大事な注意
- この初期版は、利用者が正当に保有・閲覧する権限のある資料の台帳管理用です。
- 非公開の乗務員用資料を入手するための列車・時刻・乗務員の特定や、取得を効率化する機能は含めません。
- `.oud` ファイルや運行時刻データは、この初期版のGitHubリポジトリにはアップロードしません。
- Supabaseの `service_role` キーやパスワードをGitHubに置かないでください。

## ファイル
- `index.html` : 画面
- `style.css` : デザイン
- `app.js` : ログインと記録一覧
- `supabase.sql` : データベースと権限設定
- `config.example.js` : Supabase設定の見本

## 次の作業
1. GitHubのリポジトリに、このフォルダ内のファイルをアップロード
2. Supabaseで新しい専用プロジェクトを作成
3. `supabase.sql` をSQL Editorで実行
4. `config.example.js` を `config.js` に複製し、Project URL と anon key を入力
5. GitHub Pagesを有効化
6. 管理者アカウントを作成し、SQL Editorで管理者権限を付与

Supabaseの接続情報を設定する段階では、画面を確認しながら一つずつ案内します。
