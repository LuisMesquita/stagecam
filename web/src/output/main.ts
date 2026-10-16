// The director draws into #out from its own window; this page only handles fullscreen and keys.
document.getElementById('hint')!.addEventListener('click', () => {
  void document.documentElement.requestFullscreen();
});

window.addEventListener('keydown', (event) => {
  const opener = window.opener as
    | (Window & { stagecamKey?: (event: KeyboardEvent) => void })
    | null;
  opener?.stagecamKey?.(event);
});
