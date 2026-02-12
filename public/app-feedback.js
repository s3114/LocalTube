(function attachUiFeedback(global) {
  function createUiFeedback({
    documentRef = document,
    dismissAfterMs = 4000,
  } = {}) {
    function ensureContainer() {
      let container = documentRef.getElementById("app-feedback");
      if (container) return container;
      container = documentRef.createElement("div");
      container.id = "app-feedback";
      container.className = "app-feedback";
      documentRef.body?.appendChild(container);
      return container;
    }

    function show(message, tone = "info") {
      const text = String(message || "").trim();
      if (!text) return;
      const container = ensureContainer();
      const item = documentRef.createElement("div");
      item.className = `app-feedback-item tone-${tone}`;
      item.textContent = text;
      container.appendChild(item);
      setTimeout(() => {
        item.remove();
      }, dismissAfterMs);
    }

    return {
      showInfo(message) {
        show(message, "info");
      },
      showSuccess(message) {
        show(message, "success");
      },
      showError(message) {
        show(message, "error");
      },
    };
  }

  global.createUiFeedback = createUiFeedback;
})(window);
