// 좌우 스와이프 인식 — 터치 전용, 임계값을 넘으면 한 번 발화한다.
//
// 세로 스크롤 본문 위의 가로 제스처라 오작동 비용이 크다. 그래서 엄격하다:
// - 가로 이동이 60px 이상이고 세로의 2배를 넘을 때만 (스크롤과 구분)
// - 손가락을 따라오는 애니메이션은 없다 — 버튼 전환과 같은 느낌으로 즉시 전환
//
// ★ 판정은 touchmove 중에 한다. 실기기 크롬은 터치가 스크롤로 판정되는 순간
//   touchend 대신 touchcancel 을 보내므로, end 만 기다리면 스와이프가 영영
//   안 잡힌다 (v41 이 실제로 그랬다). move 에서 임계값을 넘는 즉시 발화한다.
//
// ★ 가장자리 여유는 두지 않는다 (v45 에서 제거). v44 진단으로 확인한 사실 —
//   왼쪽으로 쓸 때 엄지는 화면 오른쪽 끝(가장자리 8px 안)에서 출발한다.
//   큰글씨 설정 기기(w=338)에서 24px 여유가 자연스러운 시작점을 전부 삼켰다.
//   뒤로가기 제스처와의 충돌 걱정은 기우다: 제스처 내비 기기는 시스템이
//   가장자리 터치를 우리보다 먼저 소비하고, 3버튼 기기는 충돌 자체가 없다.
// 진단 — 주소에 #debug 를 붙여 열면 main.js 가 오버레이를 만들고 여기로 잇는다
const dbg = (s) => { if (window.__swipeDbg) window.__swipeDbg(s); };

export function onSwipe(el, { left, right, enabled = () => true } = {}) {
  const DIST = 60;
  let sx = 0, sy = 0, live = false;

  const fire = (t, why) => {
    const dx = t.clientX - sx, dy = t.clientY - sy;
    dbg(`${why} dx=${Math.round(dx)} dy=${Math.round(dy)}`);
    if (Math.abs(dx) < DIST || Math.abs(dx) < Math.abs(dy) * 2) return;
    live = false;
    dbg(`FIRE ${dx < 0 ? "left" : "right"}`);
    if (dx < 0 && left) left();
    else if (dx > 0 && right) right();
  };

  el.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    live = e.touches.length === 1 && enabled();
    sx = t.clientX; sy = t.clientY;
    dbg(`start x=${Math.round(sx)} live=${live}`);
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (!live) return;
    if (e.touches.length > 1) { live = false; return; }
    fire(e.touches[0], "move");
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (!live) return;
    live = false;
    fire(e.changedTouches[0], "end");
  }, { passive: true });
  el.addEventListener("touchcancel", () => { dbg("cancel"); live = false; }, { passive: true });
}
