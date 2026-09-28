#!/bin/sh
# 把「球球大冒險」推上 GitHub Pages，並且**等到網站真的建好、線上真的換成這一版**才算數（2026-09-27）。
#
# 上線方式：本機打包，把 dist 推到 gh-pages 分支（網站設定＝gh-pages 分支的根目錄，build_type legacy）。
# 為什麼不用雲端 Actions：本機 GitHub 命令列工具的登入權杖沒有 `workflow` 權限，推送帶著
# .github/workflows/ 的檔會被整筆拒收。雲端流程的範本放在 docs/ci/deploy.yml.txt，檔頭寫了怎麼改回去。
#
# 用法（在專案資料夾裡，用 Git Bash 跑）：
#   sh tools/deploy.sh            把本機 main 推上去並上線
#   sh tools/deploy.sh 分支名      把別的分支當成 main 推上去並上線
#
# 五步，缺一步都不能說上線（做法照 qiuqiu-coop 的 tools/deploy.sh：`git push` 成功不等於線上換了）：
#   1. 另開暫時工作目錄，只放要推的那一筆提交（工作目錄裡沒提交、忘了 git add 的檔不會混進來），
#      照鎖檔 npm ci、CI=true 跑測試、打包，記下主程式檔名；紅了就停
#   2. 推原始碼到 origin 的 main
#   3. 把那份 dist（加 .nojekyll）當成一筆全新的孤兒提交，強制推到 gh-pages——
#      只留一筆，不讓每次約 200 MB 的打包結果疊在歷史裡
#   4. 等網站建置完成（pages/builds/latest 對到這一筆、狀態 built；errored 就印錯誤）
#   5. 抓線上首頁（加查詢字串破快取），主程式檔名跟第 1 步打出來的一樣，才印「上線了」
#
# 線上網址只抓來看、唯讀；不會在線上網址寫任何東西。

set -u
src="${1:-main}"
repo=yayaxcharles/qiuqiu-adventure
site=https://yayaxcharles.github.io/qiuqiu-adventure/

top=$(git rev-parse --show-toplevel) || exit 1
cd "$top" || exit 1
sha=$(git rev-parse --verify "$src^{commit}") || { echo "✗ 找不到分支或提交：$src"; exit 1; }
short=$(git rev-parse --short "$sha")
url=$(git remote get-url origin) || { echo "✗ 沒有設定遠端 origin"; exit 1; }
who_name=$(git config user.name) || { echo "✗ 這個倉庫沒設 user.name"; exit 1; }
who_mail=$(git config user.email) || { echo "✗ 這個倉庫沒設 user.email"; exit 1; }

# 提醒：沒提交的改動不會上線（只提醒、不擋）
dirty=$(git status --porcelain | wc -l | tr -d ' ')
[ "$dirty" -gt 0 ] && echo "⚠ 工作目錄還有 $dirty 個沒提交的改動或新檔，這些不會上線（要上線先 git add、git commit）"

# 網站設定要是「gh-pages 分支根目錄」；被改掉的話改回來
cfg=$(gh api "repos/$repo/pages" --jq '.build_type + " " + .source.branch + " " + .source.path' 2>/dev/null)
if [ "$cfg" != "legacy gh-pages /" ]; then
  echo "⚠ 網站設定是「${cfg:-查不到}」，改回 gh-pages 分支根目錄"
  gh api -X PUT "repos/$repo/pages" -f build_type=legacy -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null \
    || { echo "✗ 改網站設定失敗"; exit 1; }
fi

# ---------- 1/5 在要推的那一筆上先跑測試與打包 ----------
tmp="$(cygpath -u "${TEMP:-/tmp}")/qiuqiu_adv_gate_$$"
log="$tmp.log"
cleanup() {
  cd "$top" || return
  git worktree remove --force "$tmp" >/dev/null 2>&1
  # 裡面的 node_modules 是 npm ci 裝的真資料夾（不是連結），刪了不會波及主資料夾
  [ -d "$tmp" ] && rm -rf "$tmp"
  rm -f "$log"
  git worktree prune >/dev/null 2>&1
}
trap cleanup EXIT

echo "== 1/5 在 $short 上跑測試與打包，約一到兩分鐘…"
git worktree prune >/dev/null 2>&1
git worktree add --detach "$tmp" "$sha" >/dev/null 2>&1 || { echo "✗ 開暫時工作目錄失敗"; exit 1; }
cd "$tmp" || exit 1
# 照這一筆的 package-lock.json 重裝，不借本機的 node_modules：本機多裝、鎖檔沒列的套件借來用會讓這裡假綠
if ! npm ci --prefer-offline --no-audit --no-fund > "$log" 2>&1; then
  echo "✗ 安裝套件失敗，這次不推："; tail -20 "$log"; exit 1
fi
if ! CI=true npx vitest run > "$log" 2>&1; then
  echo "✗ 測試紅了，這次不推。紅的是："
  grep -E "FAIL |Test Files |Tests " "$log" | head -20
  echo "（完整輸出：$(cygpath -w "$log")）"
  exit 1
fi
grep -E "Test Files |Tests " "$log"
if ! npm run build > "$log" 2>&1; then
  echo "✗ 打包失敗（型別或 vite），這次不推："
  grep -E "error|Error" "$log" | head -20
  echo "（完整輸出：$(cygpath -w "$log")）"
  exit 1
fi
want=$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' dist/index.html | head -1)
[ -n "$want" ] || { echo "✗ 打包出來的 index.html 找不到主程式檔名"; exit 1; }
# 素材裡有底線開頭的檔（例如 _anim.json），沒有 .nojekyll 的話 GitHub Pages 的 Jekyll 會把它們丟掉
: > dist/.nojekyll
under=$(cd dist && find . -name '_*' -type f | head -1 | sed 's#^\./##')
echo "   綠的，本機打出來的主程式是 $want（$(find dist -type f | wc -l | tr -d ' ') 個檔）"
rm -f "$log"
cd "$top" || exit 1

# ---------- 2/5 推原始碼 ----------
echo "== 2/5 推 $src（$short）到 origin 的 main"
git push origin "$sha:refs/heads/main" || { echo "✗ 推送沒成功（網路問題，或遠端有本機沒有的提交）"; exit 1; }

# ---------- 3/5 推打包結果到 gh-pages ----------
echo "== 3/5 把打包結果強制推到 gh-pages（孤兒分支、只留一筆）"
pub="$tmp/dist"
(
  cd "$pub" || exit 1
  git init -q -b gh-pages . || exit 1
  # 照打包出來的位元組原樣提交，不做換行轉換（這台全域是 autocrlf=true）
  git config core.autocrlf false
  git add -A || exit 1
  git -c user.name="$who_name" -c user.email="$who_mail" commit -q -m "部署 $short（main $sha）" || exit 1
  git push -f -q "$url" gh-pages:gh-pages || exit 1
) || { echo "✗ 推 gh-pages 失敗"; exit 1; }
pages_sha=$(git -C "$pub" rev-parse HEAD)
echo "   gh-pages 現在是 $(git -C "$pub" rev-parse --short HEAD)"

# ---------- 4/5 等網站建置完成 ----------
echo "== 4/5 等 GitHub Pages 建置完成"
status=""
tries=0
# 用 until 不用 while：還沒等到這一筆建好就繼續等（記憶池 reference_wait_for_process_windows）
until [ "$status" = "built" ] || [ "$status" = "errored" ]; do
  tries=$((tries + 1))
  [ "$tries" -gt 100 ] && { echo "✗ 十分鐘內沒等到 gh-pages 這一筆建好（最後狀態：${status:-查不到}）"; exit 1; }
  sleep 6
  line=$(gh api "repos/$repo/pages/builds/latest" --jq '.commit + " " + .status' 2>/dev/null)
  if [ "${line%% *}" = "$pages_sha" ]; then status="${line#* }"; else status=""; fi
done
if [ "$status" = "errored" ]; then
  echo "✗ 網站建置失敗："
  gh api "repos/$repo/pages/builds/latest" --jq '.error.message' 2>/dev/null
  exit 1
fi
echo "   建置完成"

# ---------- 5/5 確認線上真的換成這一版 ----------
echo "== 5/5 確認線上真的換成這一版"
got=""
tries=0
until [ "$got" = "$want" ]; do
  tries=$((tries + 1))
  [ "$tries" -gt 30 ] && break
  # 加查詢字串破快取（Pages 的快取約十分鐘）
  got=$(curl -s "$site?v=$(date +%s)" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
  [ "$got" = "$want" ] || sleep 6
done
if [ "$got" != "$want" ]; then
  echo "✗ 線上主程式是 ${got:-（抓不到）}，這次打出來的是 $want——線上還不是這一版"
  exit 1
fi
# 順便確認底線開頭的素材有被放出來（.nojekyll 有效）
if [ -n "$under" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "$site$under?v=$(date +%s)")
  [ "$code" = "200" ] || { echo "✗ 底線開頭的素材抓不到（$under 回 $code），.nojekyll 可能沒生效"; exit 1; }
fi
echo "✓ 上線了：$site（主程式 $got）"
