/*
  ENG-654 visualization bootstrap.
  Navigation is intentionally loaded separately through js/deck/nav-runtime.js
  so slide movement still works if a visualization module fails.
*/

document.addEventListener('DOMContentLoaded', async () => {
  const loaders = [
    async () => {
      const module = await import('./viz/robot2r.js');
      module.initRobot2R?.();
    },
    async () => {
      const module = await import('./viz/threeRevolute.js');
      module.initThreeRevoluteDemos?.();
    },
    async () => {
      const module = await import('./viz/frameDHPlayground.js');
      module.initFrameDHPlaygrounds?.();
    }
  ];

  for (const load of loaders) {
    try {
      await load();
    } catch (error) {
      console.error('ENG-654 visualization module failed:', error);
    }
  }
});
