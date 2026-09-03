// 좌우 스와이프 인식 — 터치 전용, 임계값을 넘으면 한 번 발화한다.
//
// 세로 스크롤 본문 위의 가로 제스처라 오작동 비용이 크다. 그래서 엄격하다:
// - 가장자리 24px 에서 시작한 터치는 무시 — 안드로이드 뒤로가기 제스처(좌우
//   가장자리 안쪽 쓸기)와 모양이 같아서, 경계에서 어긋난 터치가 노트를 열면
//   뒤로가기라는 몸에 밴 동작에 대한 신뢰가 깎인다
// - 가로 이동이 60px 이상이고 세로의 2배를 넘을 때만 (스크롤과 구분)
// - 손가락을 따라오는 애니메이션은 없다 — 버튼 전환과 같은 느낌으로 즉시 전환
export function onSwipe(el, { left, right, enabled = () => true } = {}) {
  const EDGE = 24, DIST = 60;
  let sx = 0, sy = 0, live = false;
  el.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    live = e.touches.length === 1 &&
           t.clientX > EDGE && t.clientX < innerWidth - EDGE && enabled();
    sx = t.clientX; sy = t.clientY;
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (!live) return;
    live = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < DIST || Math.abs(dx) < Math.abs(dy) * 2) return;
    if (dx < 0 && left) left();
    else if (dx > 0 && right) right();
  }, { passive: true });
}
