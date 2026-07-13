import { Link } from "@tanstack/react-router";
import React, { useEffect } from "react";

export default function AboutPage() {
  useEffect(() => {
    document.title = "Fixture About";
    const previousClass = document.body.className;
    document.body.className = "";
    return () => { document.body.className = previousClass; };
  }, []);

  return (
    <>
    {"\n    "}
    <main>
      {"\n      "}
      <Link to={"/"}>
        {"Home"}
      </Link>
      {"\n      "}
      <h1>
        {"About fixture"}
      </h1>
      {"\n    "}
    </main>
    {"\n  \n\n"}

    </>
  );
}
