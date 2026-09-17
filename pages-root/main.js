const stage = document.querySelector(".stage");

if (stage && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const onMove = (event) => {
    const x = (event.clientX / window.innerWidth - 0.5) * 8;
    const y = (event.clientY / window.innerHeight - 0.5) * 6;
    stage.style.transform = `translate3d(${x * -0.15}px, ${y * -0.12}px, 0)`;
  };

  window.addEventListener("pointermove", onMove, { passive: true });
}
