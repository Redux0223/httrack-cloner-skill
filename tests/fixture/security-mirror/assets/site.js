const button = document.querySelector("#counter");
let count = 0;
const modelUrl = "/assets/models/test.glb";
const audioUrl = `${location.origin}/assets/audio/test.mp3`;
import("./lazy.js").then((module) => module.prepare?.());

button?.addEventListener("click", () => {
  count += 1;
  button.textContent = `Count ${count} ${modelUrl.length + audioUrl.length}`;
});
