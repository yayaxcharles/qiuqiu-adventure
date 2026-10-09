/**
 * 自動玩（網址加 ?bot 就接上；tools/stage1_play.mjs 用它把第一關從頭玩到過關）。
 * 不是作弊：只看畫面上看得到的東西、按跟玩家一樣的鍵——
 *   一直往右；前面有敵人就停下來丟（貼近了自動揮爪）；看到預兆就躲：震波、野豬、滾過來的大王跳過去，
 *   苦無蹲下或跳，魚骨頭、泰山壓頂的影子就跑開；坑、高台跳過去；打魔王保持距離、跳起來丟打背包、丟爆裂符。
 */
import { ENEMY_DEFS, enemyBox } from './enemies';
import { RAM_DIST } from './enemies3';
import { isGate, VIEW_W } from './entities';
import type { Game } from './game';
import { NO_INPUT, type Frame } from './input';
import { BODY_HW, STEP_UP } from './physics';
import type { World } from './world';
import { WEAPONS } from './weapons';

export function createBot(): (g: Game, dt: number) => Frame {
  const s = { airGoal: NaN, wantAir: false, kickCd: 0, kickDir: 1, v2Jump: 0, backT: 0, atkT: 0, jumpHold: 0, jumpCd: 0, subT: 3, startT: 0, progX: 0, stuckT: 0, turnT: 0, crouchT: 0, bossJumpT: 0 };
  return (g: Game, dt: number): Frame => {
    const f: Frame = { ...NO_INPUT };
    s.atkT -= dt; s.jumpCd -= dt; s.kickCd -= dt; s.v2Jump -= dt; s.subT -= dt; s.turnT -= dt; s.bossJumpT -= dt;
    if (g.screen === 'title' || g.screen === 'continue') {
      if ((s.startT += dt) > 0.6) { s.startT = 0; f.startPressed = true; }
      return f;
    }
    if (g.screen !== 'play' || !g.world) return f;
    const w = g.world, p = w.player, b = p.body;
    if (w.state !== 'play' || !p.alive) return f;
    const px = b.x, py = b.y;
    // 攀爬中：一路往上爬到頂（第二版練習場）
    if (p.act === 'climb') { f.up = true; return f; }

    let jump = false, crouch = false, flee = 0;
    /** 這個威脅可以用翻滾穿過去（衝過來的、低的橫飛子彈）：地上、能滾、前面 280 內沒坑就滾，不然照舊跳 */
    let rollable = false;
    // ── 躲 ──
    for (const bl of w.bullets) {
      const dx = bl.x - px, closing = -Math.sign(dx) * bl.vx;
      if (bl.kind === 'wave') { if (closing > 0 && Math.abs(dx) / closing < 0.3 && Math.abs(dx) > 10) jump = true; }
      // 橫飛的東西（苦無、火球、水彈、葉子、扇子）：低的就蹲、高的就跳
      else if (bl.kind === 'kunai' || bl.kind === 'fireball' || bl.kind === 'water' || bl.kind === 'leaf' || bl.kind === 'fan' || bl.kind === 'pellet') {
        const t = Math.abs(dx) / Math.max(1, Math.abs(bl.vx) + Math.abs(bl.vy));
        // 斜著往下打來的（燈籠鬼瞄準的火球）：往反方向跑開
        if ((bl.kind === 'fireball' || bl.kind === 'pellet') && bl.vy > 60 && t < 0.6 && Math.abs(dx) < 380) { flee = dx > 0 ? -1 : 1; continue; }
        if (t < 0.4 && Math.abs(bl.y + bl.vy * t - (py - 90)) < 90) {
          if (Math.abs(bl.vy) < 60 && bl.y < py - 100 && p.anim.has('crouch') && b.onGround) crouch = true;
          else { jump = true; if (t < 0.25 && Math.abs(bl.vy) < 200) rollable = true; }
        }
      } else if (bl.kind === 'bone' || bl.kind === 'garbage') {
        const t = Math.max(0, (py - 80 - bl.y) / Math.max(200, bl.vy));
        const lx = bl.x + bl.vx * t;
        if (Math.abs(lx - px) < (bl.kind === 'garbage' ? 140 : 110)) flee = lx > px ? -1 : 1;
      } else if (bl.kind === 'missile' && bl.vy > 0) {
        if (Math.abs(bl.x - px) < 130) flee = bl.x > px ? -1 : 1;
      } else if (bl.kind === 'blast' && Math.abs(dx) < 260) flee = dx > 0 ? -1 : 1;
      else if (bl.kind === 'splash' && Math.abs(dx) < 120 && bl.vy > 0) flee = dx > 0 ? -1 : 1;
    }
    const alive = w.enemies.filter((e) => e.dying <= 0 && !e.dead);
    for (const e of alive) {
      const dx = e.x - px, adx = Math.abs(dx);
      const toward = (dir: number): boolean => dir * dx < 0;
      if (e.state === 'charge' && toward(e.facing) && adx < 330) { jump = true; rollable = true; }
      if (e.kind === 'orange_king') {
        const spd = e.p2 ? 800 : 540;
        if (e.state === 'roll' && toward(e.mem.dir ?? -1) && adx < spd * 0.32 + 130) { jump = true; rollable = adx < spd * 0.2 + 130; }
        if (e.state === 'rollWind' && adx < 200) flee = dx > 0 ? -1 : 1;
        if ((e.state === 'crushShadow' || e.state === 'belly') && Math.abs((e.mem.tx ?? e.x) - px) < 230) flee = (e.mem.tx ?? e.x) > px ? -1 : 1;
      }
      if (e.kind === 'drum_tanuki' && e.state === 'blastWind' && adx < 330) flee = dx > 0 ? -1 : 1;
      if (e.kind === 'crow_small' && e.state === 'swoop' && adx < 200 && e.y > py - 260) crouch = crouch || false;
      if (e.kind === 'wild_boar' && e.state === 'windup' && adx < 260) flee = dx > 0 ? -1 : 1;
      // 蛙大名的舌頭：張嘴就蹲下（舌頭在頭的高度）
      if (e.kind === 'frog_daimyo' && (e.state === 'tongueWind' || e.state === 'tongue') && adx < 560 && b.onGround) crouch = true;
      if (e.kind === 'frog_daimyo' && e.state === 'jumpAir' && Math.abs((e.mem.tx ?? e.x) - px) < 200) flee = (e.mem.tx ?? e.x) > px ? -1 : 1;
      // ── 第三關 ──
      const inFront = (e.x - px) * e.facing < 0;   // 球球在牠面前
      if (e.kind === 'broom_centipede' && e.state === 'rear' && adx < 420) flee = dx > 0 ? -1 : 1;
      if (e.kind === 'iron_arhat' && (e.state === 'windup' || e.state === 'punch') && inFront && adx < 290 && b.onGround) crouch = true;
      if (e.kind === 'armor_ghost' && ((e.state === 'windup' && e.t > 0.25) || e.state === 'thrust') && inFront && adx < 340 && b.onGround) crouch = true;
      if (e.kind === 'wraith_samurai' && (e.state === 'appear' || e.state === 'slash') && adx < 300) flee = dx > 0 ? -1 : 1;
      if (e.kind === 'guardian_statue' && (e.state === 'windup' || e.state === 'swipe') && adx < 330) flee = dx > 0 ? -1 : 1;
      if (e.kind === 'roomba_king') {
        if (e.state === 'suck' || e.state === 'suckWind') flee = dx > 0 ? -1 : 1;
        if ((e.state === 'ramWind' || e.state === 'ram') && inFront && adx < ENEMY_DEFS[e.kind].w / 2 + RAM_DIST + 110) flee = dx > 0 ? -1 : 1;
      }
      if (e.kind === 'iron_claw') {
        const wind = e.p2 ? 0.5 : 0.7;
        if (((e.state === 'swipeWind' && e.t > wind - 0.22) || (e.state === 'swipe' && e.t < 0.15)) && inFront && adx < 470) jump = true;
      }
    }
    // 飛彈的落點：離開瞄準圈
    for (const k of w.marks) if (Math.abs(k.x - px) < 140) flee = k.x > px ? -1 : 1;
    // 鐵爪二階：低的雷射、暴走衝撞 → 躲上屋脊；高的雷射 → 蹲下（站在屋脊上就先跳下來）
    let seekRidge = false, leaveRidge = false;
    const claw = w.boss && w.boss.kind === 'iron_claw' && w.boss.dying <= 0 ? w.boss : null;
    if (claw && ((claw.state === 'laserWind' || claw.state === 'laser') && claw.mem.low || claw.state === 'rampageWind' || claw.state === 'rampage')) seekRidge = true;
    // 掃地機王要衝撞、自己在衝撞範圍裡：躲上鐵走道（範圍外就不用）
    const rb = w.boss && w.boss.kind === 'roomba_king' && w.boss.dying <= 0 ? w.boss : null;
    if (rb && (rb.state === 'ramWind' || rb.state === 'ram') && (rb.x - px) * rb.facing < 0 && Math.abs(rb.x - px) < ENEMY_DEFS.roomba_king.w / 2 + RAM_DIST + 110) { seekRidge = true; flee = 0; }
    if (claw && (claw.state === 'laserWind' || claw.state === 'laser') && !claw.mem.low) { if (p.onPlatform(w)) leaveRidge = true; else if (b.onGround) crouch = true; }

    // ── 挑目標：前面的優先；背後的只有貼近（350 以內）才轉身打；前面的在高處（屋頂、瞭望台）就跳起來丟 ──
    const boss = w.boss && !w.boss.dead && w.boss.state !== 'die' && w.boss.state !== 'start' ? w.boss : null;
    const onScreen = alive.filter((e) => w.onScreen(e.x, -20) && e.kind !== 'dummy' && !(e.invuln > 5 && !e.boss));
    const handY = py - 112;
    const reachable = (e: typeof alive[number]): boolean => { const bx = enemyBox(e); return bx.y0 < handY + 20 && bx.y1 > handY - 20; };
    const ahead = onScreen.filter((e) => e.x - px > -40).sort((a, c) => (a.x - px) - (c.x - px));
    const behind = onScreen.filter((e) => e.x - px <= -40 && px - e.x < 350 && e.aware).sort((a, c) => (c.x - a.x));
    // 打得掉的子彈（狐火、泡泡）靠近了也當目標
    const shootable = w.bullets.find((bl) => bl.hp !== undefined && Math.abs(bl.x - px) < 420 && Math.abs(bl.y - handY) < 90);
    const target = boss ?? behind[0] ?? ahead[0];
    let move = 1;
    let jumpThrow = false, dropDown = false, aimDown = false;
    if (boss) {
      const want = 430, side = boss.x > px ? 1 : -1, d = Math.abs(boss.x - px);
      const ar = w.arena();
      if (d < want - 90) move = -side; else if (d > want + 120) move = side; else move = 0;
      if (b.facing !== side && move !== side) { move = side; }   // 先轉身面對魔王
      // 被逼到角落：從魔王頭上跳過去換邊（大王太高跳不過：趁剛被打的無敵時間直接穿過去）
      const cornered = (px < ar.x0 + 160 && side > 0 && d < 330) || (px > ar.x1 - 160 && side < 0 && d < 330);
      if (cornered) { move = side; if (boss.kind !== 'orange_king') jump = true; }
      if (d < 260 && p.invincible > 0.35) move = side;
    } else if (target) {
      const dx = target.x - px, adx = Math.abs(dx), dir = Math.sign(dx) || 1;
      const flying = ENEMY_DEFS[target.kind].fly;
      // 飛的：走到牠底下往上丟；牠要俯衝了就往另一邊跑開
      // 牆上的甲蟲砲台（不會俯衝）：走到底下往上丟就好
      if (flying && target.mem.mount) move = adx > 45 ? dir : 0;
      else if (flying) { move = adx > 45 ? dir : 0; if (target.state === 'windup' || target.state === 'swoop') move = -dir; }
      // 鐵羅漢護甲關著（正面丟不進去）：貼上去揮爪（牠出拳的時候蹲下）
      else if (target.kind === 'iron_arhat' && !['windup', 'punch', 'recover'].includes(target.state)) move = adx > 120 ? dir : 0;
      else if (reachable(target)) { move = adx > 330 ? dir : 0; if (b.facing !== dir) move = dir; }
      else if (enemyBox(target).y0 > handY + 20) {
        // 在下面（自己站在屋頂、木架上）：走過去；靠近了就「↓＋跳」跳下平台，空中朝下丟
        move = adx > 60 ? dir : 0;
        if (b.onGround && adx < 220 && p.onPlatform(w)) dropDown = true;
        // 站在實心方塊頂上（原木高台、大岩塊）：沒辦法「↓＋跳」穿下去，直接走下邊緣
        if (b.onGround && w.solids.some((q) => Math.abs(q.y - py) < 1 && px + BODY_HW > q.x && px - BODY_HW < q.x + q.w)) move = dir;
        if (!b.onGround && adx < 90) aimDown = true;
      } else {
        // 在高處：靠近到 260 以內，跳起來丟；太近了就退一點
        move = adx > 260 ? dir : adx < 120 ? -dir : 0;
        if (b.facing !== dir && move === 0) move = dir;
        jumpThrow = true;
      }
    }
    // 寨門、瞭望台、木箱：停下來打
    // 只有寨門一定要打爛；木箱、攤位這些打得到才順手打（站在木架上打不到下面的就走過去）
    const blocker = w.breakables.find((k) => !k.broken && k.x > px && w.onScreen(k.x, -10) && (isGate(k.kind) ? k.x - px < 520
      : k.kind !== 'tower' && k.x - px < 200 && k.y - k.h < handY + 20 && k.y > handY - 20));
    if (blocker && (isGate(blocker.kind) || blocker.x - px < 150)) move = Math.min(move, 0);
    // 附近沒有敵人時，回頭撿掉在地上的東西（村貓丟過來的忍具常常落在背後）
    if (!boss && (!target || Math.abs(target.x - px) > 600)) {
      const item = w.pickups.find((k) => !k.taken && k.age > 0.4 && k.onGround && k.x > w.camX + 60 && w.onScreen(k.x, -30) && Math.abs(k.x - px) < 520 && Math.abs(k.y - py) < 140);
      if (item && Math.abs(item.x - px) > 16) move = Math.sign(item.x - px);
    }
    // 站著打的時候先轉身面向要打的東西（按一下方向鍵就轉過去）
    const atkDir = boss ? Math.sign(boss.x - px) : target && (!blocker || Math.abs(target.x - px) < Math.abs(blocker.x - px)) ? Math.sign(target.x - px) : blocker ? 1 : 0;
    if (move === 0 && atkDir && b.facing !== atkDir) move = atkDir;
    if (flee) move = flee;

    // 躲上屋脊：走到最近的屋脊底下，跳上去；在上面就站著（站中間）
    if (seekRidge) {
      const ridges = w.platforms.filter((pl) => pl.y < w.groundAt(pl.x + pl.w / 2) - 100 && w.onScreen(pl.x + pl.w / 2, -40));
      const on = ridges.find((pl) => b.onGround && Math.abs(b.y - pl.y) < 1 && px >= pl.x && px <= pl.x + pl.w);
      if (on) { const c = on.x + on.w / 2; move = Math.abs(px - c) > 30 ? Math.sign(c - px) : 0; flee = 0; }
      else if (ridges.length) {
        const r = ridges.sort((a, c) => Math.abs(a.x + a.w / 2 - px) - Math.abs(c.x + c.w / 2 - px))[0]!;
        const c = r.x + r.w / 2;
        move = Math.abs(px - c) > 20 ? Math.sign(c - px) : 0;
        if (b.onGround && Math.abs(px - c) < r.w / 2 + 40) jump = true;
      }
    }
    // 升降台：牆太高跳不上去、旁邊有升降台：走到升降台中間等，升到頂再往前走
    const lift = w.platforms.find((pl) => pl.lift && pl.x < px + 520 && pl.x + pl.w > px - 60);
    let riding = false;
    if (lift && lift.lift && b.y > lift.lift.y1 - 5) {
      const c = lift.x + lift.w / 2, top = lift.lift.y1;
      const onLift = b.onGround && Math.abs(b.y - lift.y) < 1 && px >= lift.x && px <= lift.x + lift.w;
      if (b.y > top + 40 || onLift) {
        riding = true;
        if (onLift && Math.abs(lift.y - top) < 2) move = 1;
        else move = Math.abs(px - c) > 24 ? Math.sign(c - px) : 0;
        jump = false;
      }
    }
    // 蒸氣噴口：前面的在冒煙、在噴就停下來等；站在噴口上就趕快走開（在鐵走道上不用管）
    for (const v of w.stage.vents ?? []) {
      const g = w.terrain.groundAt(v.x);
      if (!Number.isFinite(g) || py < g - 100) continue;
      const st = w.ventState(v), hot = st.on || st.warn;
      const d = (v.x - px) * (move || 1);
      if (!hot) continue;
      // 往外走；那一邊是畫面邊（魔王場地的牆）就往另一邊走（10-10：被夾在牆角的噴口上一直燙）
      if (Math.abs(v.x - px) < 64) { const out = px < v.x ? -1 : 1, edge = out > 0 ? px > w.camX + VIEW_W - 90 : px < w.camX + 90; move = edge ? -out : out; }
      else if (d > 0 && d < 150) move = 0;
    }

    // 坑、高台：前面地面不見了或高出一截就跳
    // 助跑跳一次約 230 像素：坑邊剩 15～55 像素、而且已經跑到快全速才起跳；還沒跑起來就先放慢到坑邊
    if (b.onGround && move !== 0 && !p.onPlatform(w) && !riding) {
      const g0 = w.groundAt(px);
      for (let d = 10; d <= 120; d += 5) {
        const g1 = w.groundAt(px + move * d);
        if (!Number.isFinite(g1) || g1 < g0 - STEP_UP) {
          const pit = !Number.isFinite(g1);
          if (!pit || (d <= 30 && Math.abs(b.vx) > 300)) jump = true;
          else if (pit && d <= 30) s.backT = 0.35;   // 還沒跑起來：退回去重新助跑
          break;
        }
      }
    }
    if (s.backT > 0) { s.backT -= dt; move = -Math.sign(move || 1); jump = false; }
    // 卡住太久（沒敵人、沒前進）：跳一下
    if (px > s.progX + 30) { s.progX = px; s.stuckT = 0; } else if (!boss && !target && !blocker) s.stuckT += dt;
    if (s.stuckT > 2.5) { jump = true; s.stuckT = 0; }

    // 打大王的背包、屋頂上的敵人：跳起來、在高處丟
    const kingP1 = boss && boss.kind === 'orange_king' && boss.part && !boss.part.broken;
    if (kingP1 && s.bossJumpT <= 0 && b.onGround && Math.abs(boss!.x - px) > 250) { jump = true; s.bossJumpT = 1.4; }
    if (jumpThrow && s.bossJumpT <= 0 && b.onGround) { jump = true; s.bossJumpT = 0.9; }

    // 第二版地形（實心方塊、攀爬物、夾縫、往上捲的區段）：沒有要打的東西時照地形決定怎麼走（二段跳、蹬牆、攀爬、踩岩棚往上）
    let v2up = false;
    // 夾縫裡、或畫面往上捲的區段還沒爬到頂而要打的在搆不到的高度：先爬（不然會在夾縫底下一直跳起來丟打不到的）
    const inShaft = (w.stage.shafts ?? []).some((z) => px > z.x0 - 4 && px < z.x1 + 4 && py > z.top - 200 && py <= z.bottom + 2);
    // 要打的隔著一道實心方塊（原木高台、岩壁）：丟過去會撞在方塊上 → 先照地形翻過去
    const walled = !!target && w.solids.some((q) => q.x < Math.max(px, target.x) && q.x + q.w > Math.min(px, target.x) && q.y < handY && q.y + q.h > handY);
    const climbFirst = inShaft || walled || (w.vsHolding() && !!target && !reachable(target));
    if (!boss && (!target || Math.abs(target.x - px) > 700 || climbFirst) && !flee && isV2(w)) {
      const nav = v2Nav(w, s);
      if (nav) {
        move = nav.move; jump = false; riding = false;
        if (nav.jump && s.v2Jump <= 0 && b.onGround) { f.jumpPressed = true; s.jumpHold = 0.34; s.v2Jump = 0.4; s.wantAir = nav.air; }
        if (nav.kick) { f.jumpPressed = true; s.jumpHold = 0.34; }
        v2up = nav.up;
      }
    }
    if (s.wantAir && !b.onGround && b.vy > -140) { f.jumpPressed = true; s.jumpHold = 0.3; s.wantAir = false; }
    if (b.onGround && s.v2Jump <= 0) s.wantAir = false;

    if (move > 0) f.right = true; else if (move < 0) f.left = true;
    if (v2up) f.up = true;
    if (crouch) { f.down = true; s.crouchT = 0.3; }

    // 翻滾：躲的是衝過來的東西、而且面向滾的方向前面 280 沒坑（也不是高台）→ 滾過去，不跳
    let roll = false;
    if (jump && rollable && b.onGround && p.dashCd <= 0 && p.act !== 'claw' && !riding) {
      const fdir = move !== 0 ? Math.sign(move) : b.facing, g0 = w.groundAt(px);
      let clear = true;
      for (let d = 20; d <= 300; d += 20) { const g1 = w.groundAt(px + fdir * d); if (!Number.isFinite(g1) || g1 < g0 - STEP_UP) { clear = false; break; } }
      if (clear) { roll = true; jump = false; if (move === 0) move = fdir; }
    }
    if (roll) { f.dashPressed = true; if (move > 0) { f.right = true; f.left = false; } else if (move < 0) { f.left = true; f.right = false; } }

    // 跳：按住 0.32 秒跳滿；下平台＝↓＋跳
    if (leaveRidge) dropDown = true;
    if (dropDown && !jump && s.jumpCd <= 0) { f.down = true; f.jumpPressed = true; s.jumpCd = 0.45; }
    else if (jump && s.jumpCd <= 0 && b.onGround) { f.jumpPressed = true; s.jumpHold = 0.32; s.jumpCd = 0.45; }
    if (s.jumpHold > 0) { f.jumpHeld = true; s.jumpHold -= dt; }

    // ── 打 ──
    const facingTargets = onScreen.filter((e) => (e.x - px) * b.facing > -30);
    let inFront = facingTargets.length > 0 || !!blocker || (!!boss && (boss.x - px) * b.facing > 0) || (!!shootable && (shootable.x - px) * b.facing > 0);
    const above = onScreen.find((e) => (ENEMY_DEFS[e.kind].fly || !reachable(e)) && Math.abs(e.x - (px + b.facing * 28)) < 70 && enemyBox(e).y1 < py - 150);
    // 斜上：飛的、高處的敵人在面前斜上 25～65 度、700 以內 → ↑＋方向斜丟（不用走到正下方）
    const hx = px + b.facing * 92, hy = py - 168;
    const diagT = above ? null : onScreen.find((e) => {
      if (!(ENEMY_DEFS[e.kind].fly || !reachable(e)) || (e.x - hx) * b.facing <= 0) return false;
      const bx = enemyBox(e), cy = (bx.y0 + bx.y1) / 2, ddx = Math.abs(e.x - hx), ddy = hy - cy;
      const ang = Math.atan2(ddy, ddx) * 180 / Math.PI;
      return ddy > 0 && ang > 25 && ang < 65 && Math.hypot(ddx, ddy) < 700;
    });
    if (above) {
      f.up = true;
      // ↑＋方向會變成斜丟：正上方的要放開方向鍵那一下才丟得直
      if (s.atkT <= 0) { f.left = false; f.right = false; }
    } else if (diagT && !boss) {
      f.up = true;
      if (!f.left && !f.right) { if (b.facing > 0) f.right = true; else f.left = true; }
    }
    if (aimDown) { f.down = true; inFront = true; }
    // 跳起來丟：上升到快最高點才丟（手的高度剛好對到屋頂上的敵人、大王的背包）
    if ((jumpThrow || kingP1) && !b.onGround && b.vy < -250) inFront = false;
    if (inFront || above || diagT) {
      // 有特殊忍具就用 K 丟（連發的按住），沒有就 J 丟手裏劍
      const sp = p.arsenal.hasSpecial;
      if (sp && WEAPONS[p.arsenal.weapon].auto) f.specialHeld = true;
      if (s.atkT <= 0) { if (sp) f.specialPressed = true; else f.attackPressed = true; s.atkT = 0.13; }
    }
    // 爆裂符：打魔王、一群敵人
    const crowd = onScreen.filter((e) => Math.abs(e.x - px) < 520).length;
    if (s.subT <= 0 && p.arsenal.subs[p.arsenal.sub] > 0 && ((boss && Math.abs(boss.x - px) < 620) || crowd >= 3)) { f.subPressed = true; s.subT = boss ? 2.2 : 4; }
    return f;
  };
}

// ───────────── 第二版地形 ─────────────

/** 這一關有第二版的地形物件 */
function isV2(w: World): boolean {
  const S = w.stage;
  return !!(S.solids?.length || S.climbs?.length || S.shafts?.length || S.vscroll?.length);
}

/** 一次跳（按住）穩穩上得去的高度、二段跳穩穩上得去的高度（物理算出來 177／306，留餘裕） */
const ONE = 165, TWO = 270;

interface Nav { move: number; jump: boolean; air: boolean; kick: boolean; up: boolean }

/**
 * 第二版地形怎麼走：
 *   夾縫（stage.shafts）裡：朝一面牆跳、碰到牆就蹬、一路左右蹬到頂，快到頂時貼著出口那面二段跳翻上去
 *   前面的牆 ONE～TWO 高：離牆 130～190 起跳、最高點二段跳；更高、或在「往上捲」的區段裡還沒爬到頂：找往上的路
 *   （頭上的岩棚、方塊頂、腳下這一層搆得到的藤蔓梯子、夾縫），挑最高的那個走過去
 */
function v2Nav(w: World, s: { kickCd: number; kickDir: number; wantAir: boolean; airGoal: number }): Nav | null {
  const p = w.player, b = p.body, px = b.x, feet = b.y;
  const nav = (move: number, o: Partial<Nav> = {}): Nav => ({ move, jump: false, air: false, kick: false, up: false, ...o });
  // ── 夾縫裡 ──
  const sh = (w.stage.shafts ?? []).find((z) => px > z.x0 - 4 && px < z.x1 + 4 && feet > z.top - (b.onGround ? 4 : 200) && feet <= z.bottom + 2);
  if (sh) {
    // 快到頂（腳離出口 40 以內）、沒貼著牆：二段跳翻上出口（右邊）那面的頂
    if (!b.onGround && feet - sh.top < 40 && b.wall === 0) {
      if (b.airJumps > 0 && b.vy > -200 && s.kickCd <= 0) { s.kickCd = 0.2; s.wantAir = true; }
      return nav(1);
    }
    if (b.onGround) { s.kickDir = 1; return nav(1, { jump: true }); }
    if (b.wall !== 0) {
      if (s.kickCd <= 0) { s.kickCd = 0.14; s.kickDir = -b.wall; return nav(-b.wall, { kick: true }); }
    }
    return nav(s.kickDir);
  }
  // 跳向某一層岩棚、方塊頂的途中：一路朝那裡飄，落地才換下一個目標
  if (b.onGround) s.airGoal = NaN;
  else if (Number.isFinite(s.airGoal)) return nav(Math.abs(px - s.airGoal) > 8 ? Math.sign(s.airGoal - px) : 0);
  const vs = w.vsection();
  const mustClimb = w.vsHolding() && feet > (vs?.release ?? -Infinity);
  // ── 前面的牆多高（地形、方塊側面） ──
  const dir = 1;
  let wallH = 0, wallD = Infinity;
  for (let d = 10; d <= 200; d += 5) {
    const x = px + dir * d;
    let top = w.groundAt(x);
    for (const q of w.solids) if (x + BODY_HW > q.x && x - BODY_HW < q.x + q.w && q.y + q.h > feet - 150 && q.y < feet - 2) top = Math.min(top, q.y);
    if (Number.isFinite(top) && top < feet - STEP_UP) { wallH = feet - top; wallD = d; break; }
  }
  if (!mustClimb && wallH > 0 && wallH <= ONE) return nav(1, { jump: wallD <= 90 });
  if (!mustClimb && wallH > ONE && wallH <= TWO) {
    if (wallD < 120 && b.onGround) return nav(-1);   // 太近了：退一點助跑
    return nav(1, { jump: wallD <= 190, air: true });
  }
  if (!mustClimb && wallH <= TWO) return null;
  // ── 找往上的路 ──
  type Step = { y: number; go: () => Nav };
  const steps: Step[] = [];
  // 找得到的範圍：前後 520；不是「往上捲的區段」時不回頭找（已經走過的夾縫、岩棚不算）；在區段裡只找區段裡的
  const near = (x0: number, x1: number): boolean => x1 > px - (mustClimb ? 520 : 60) && x0 < px + 520 && (!mustClimb || (x1 > vs!.x0 && x0 < vs!.x1));
  // 腳下這一塊（平台、方塊頂）的左右範圍；站在地面上＝無限
  let sx0 = -Infinity, sx1 = Infinity;
  if (b.onGround && Math.abs(w.groundAt(px) - feet) > 1) {
    for (const pl of w.platforms) if (Math.abs(pl.y - feet) < 1 && px >= pl.x && px <= pl.x + pl.w) { sx0 = pl.x; sx1 = pl.x + pl.w; }
    for (const q of w.solids) if (Math.abs(q.y - feet) < 1 && px + BODY_HW > q.x && px - BODY_HW < q.x + q.w) { sx0 = q.x - BODY_HW; sx1 = q.x + q.w + BODY_HW; }
  }
  const toward = (tx: number, jumpNow: boolean, need: number): Nav => {
    // 目標不在腳下這一塊上：走到邊上起跳，一路飄過去（走下去會掉回地面）
    if (tx > sx1 - 10 || tx < sx0 + 10) {
      const edge = tx > sx1 - 10 ? sx1 - 14 : sx0 + 14;
      if (Math.abs(px - edge) > 16) return nav(Math.sign(edge - px));
      s.airGoal = tx;
      return nav(Math.sign(tx - px), { jump: true, air: need > 110 || Math.abs(tx - px) > 110 });
    }
    if (Math.abs(px - tx) > 22) return nav(Math.sign(tx - px));
    if (jumpNow) s.airGoal = tx;
    return nav(0, { jump: jumpNow, air: need > ONE });
  };
  for (const pl of w.platforms) {
    const need = feet - pl.y;
    if (need < 20 || need > TWO || !near(pl.x, pl.x + pl.w)) continue;
    // 站在岩棚上：隔太遠（跳過去要 240 以上）的先不算，一層一層跳（第一關瀑布前的岩棚）
    if (Math.max(0, pl.x - sx1, sx0 - (pl.x + pl.w)) > 240) continue;
    const tx = Math.max(pl.x + 40, Math.min(pl.x + pl.w - 40, px));
    steps.push({ y: pl.y, go: () => (b.onGround ? toward(tx, true, need) : nav(Math.abs(px - tx) > 10 ? Math.sign(tx - px) : 0)) });
  }
  for (const q of w.solids) {
    const need = feet - q.y;
    if (need < 20 || need > TWO || !near(q.x, q.x + q.w)) continue;
    const side = px < q.x ? -1 : 1, ex = side < 0 ? q.x - 40 : q.x + q.w + 40;
    steps.push({ y: q.y, go: () => (b.onGround ? (Math.abs(px - ex) > 26 ? nav(Math.sign(ex - px)) : (s.airGoal = side < 0 ? q.x + 30 : q.x + q.w - 30, nav(-side, { jump: true, air: need > ONE }))) : nav(-side)) });
  }
  (w.stage.climbs ?? []).forEach((c, i) => {
    if (feet < c.top + 4 || feet > c.bottom + 2 || !near(c.x, c.x) || c.top > feet - 60) return;
    // 走得過去：藤蔓底下這一層有地（腳的高度一樣）
    if (Math.abs(floorUnder(w, c.x) - feet) > 4 && !(feet >= c.bottom - 2)) return;
    void i;
    steps.push({ y: c.top, go: () => (Math.abs(px - c.x) > 16 ? nav(Math.sign(c.x - px)) : nav(0, { up: true })) });
  });
  for (const z of w.stage.shafts ?? []) {
    if (feet < z.top || !near(z.x0, z.x1)) continue;
    if (Math.abs(z.bottom - feet) > 4) continue;
    steps.push({ y: z.top, go: () => nav(Math.sign((z.x0 + z.x1) / 2 - px) || 1) });
  }
  if (!steps.length) return mustClimb ? nav(1) : null;
  steps.sort((a, c) => a.y - c.y);
  return steps[0]!.go();
}

/** x 處腳底下最高的站立面：地面、平台、方塊頂 */
function floorUnder(w: World, x: number): number {
  let f = w.groundAt(x);
  const feet = w.player.body.y;
  for (const pl of w.platforms) if (x >= pl.x && x <= pl.x + pl.w && pl.y >= feet - 1 && pl.y < f) f = pl.y;
  for (const q of w.solids) if (x > q.x && x < q.x + q.w && q.y >= feet - 1 && q.y < f) f = q.y;
  return f;
}
