import { Link } from "@tanstack/react-router";
import React, { useEffect } from "react";

const localRuntimeScripts = [
  {
    "src": "/assets/site.js",
    "type": "module"
  },
  {
    "src": "/legacy/HomePage-0.js",
    "type": "text/javascript"
  }
];

function useLocalRuntimeAdapter() {
  useEffect(() => {
    let disposed = false;
    const mounted: HTMLScriptElement[] = [];
    const load = async () => {
      for (const entry of localRuntimeScripts) {
        if (disposed) return;
        await new Promise<void>((resolve) => {
          const script = document.createElement("script");
          script.src = entry.src;
          script.type = entry.type;
          script.async = false;
          script.dataset.localRuntimeAdapter = "true";
          script.addEventListener("load", () => resolve(), { once: true });
          script.addEventListener("error", () => resolve(), { once: true });
          document.body.appendChild(script);
          mounted.push(script);
        });
      }
    };
    void load();
    return () => {
      disposed = true;
      for (const script of mounted) script.remove();
    };
  }, []);
}
export default function HomePage() {
  useLocalRuntimeAdapter();
  useEffect(() => {
    document.title = "Fixture Home";
    const previousClass = document.body.className;
    document.body.className = "";
    return () => { document.body.className = previousClass; };
  }, []);

  return (
    <>
    {"\n    "}
    <main id={"fixture-root"}>
      {"\n      "}
      <Link to={"/about"}>
        {"About"}
      </Link>
      {"\n      "}
      <h1 style={{ backgroundImage: "url(\"/assets/hero.png\")" } as React.CSSProperties}>
        {"Fixture"}
      </h1>
      {"\n      "}
      <img src={"/assets/hero.png"} srcSet={"/assets/hero.png 1x, /assets/hero%402x.png 2x"} alt={"Fixture hero"} />
      {"\n      "}
      <button id={"counter"} type={"button"}>
        {"Count 0"}
      </button>
      {"\n    "}
    </main>
    {"\n    "}
    {"\n    "}
    {"\n  \n\n"}
      <main id="local-runtime-root" data-local-runtime-adapter="true" style={{ display: "contents" }} />
    </>
  );
}
