document.addEventListener("DOMContentLoaded", () => {
  const year = new Date().getFullYear();
  const footer = document.querySelector("footer .wrap");
  if (footer) {
    footer.textContent = `EzApply · MIT License · © ${year}`;
  }

  // hits.sh has no CORS headers (fetch() is blocked), but it works fine as an
  // <img> src, so the badge is loaded directly rather than via fetch/JSON.
  // The badge itself (set in HTML) is always visible on page load; clicking
  // Download re-requests it with a cache-buster so the shown count bumps
  // immediately rather than waiting for the next page view.
  const badge = document.getElementById("download-count-badge");
  const downloadBtn = document.getElementById("download-btn");

  if (badge && downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      badge.src = `https://hits.sh/ezapply.dev/downloads.svg?label=downloads&style=flat-square&color=1a56db&t=${Date.now()}`;
    });
  }
});
