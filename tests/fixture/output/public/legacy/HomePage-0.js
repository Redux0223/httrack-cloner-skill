
      window._CACHE_ = "123";
      var bundleName = "constructed";
      var bundlePath = "assets/" + bundleName + "." + window._CACHE_ + ".js";
      var bundleScript = document.createElement("script");
      bundleScript.src = bundlePath;
      document.head.appendChild(bundleScript);
    