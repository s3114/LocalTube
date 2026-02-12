(function attachAppState(global) {
  if (global.AppState) return;

  global.AppState = {
    pendingVideoId: null,
    lastSelectedFilename: null,
    jobStates: new Map(),
  };
})(window);
