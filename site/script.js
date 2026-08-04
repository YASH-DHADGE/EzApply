document.addEventListener("DOMContentLoaded", () => {
  const year = new Date().getFullYear();
  const footer = document.querySelector("footer .wrap");
  if (footer) {
    footer.textContent = `EzApply · MIT License · © ${year}`;
  }
});
