fn main() {
    // MinGW (WinLibs) bin-map: via de omgevingsvariabele MINGW_BIN, anders de standaard
    // winget-installatie (winget install BrechtSanders.WinLibs.POSIX.UCRT) van deze gebruiker.
    println!("cargo:rerun-if-env-changed=MINGW_BIN");
    let mingw_bin = std::env::var("MINGW_BIN").unwrap_or_else(|_| {
        format!(
            r"{}\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin",
            std::env::var("LOCALAPPDATA").unwrap_or_default()
        )
    });
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let specs_path = format!("{}/no-default-manifest.specs", out_dir);
    let manifest_xml_path = format!("{}/app.manifest", out_dir).replace('\\', "/");
    let clean_rc_path = format!("{}/clean.rc", out_dir);

    let specs_content = "*endfile:\n%{mdaz-ftz:crtfastmath.o%s;Ofast|ffast-math|funsafe-math-optimizations:%{!shared:%{!mno-daz-ftz:crtfastmath.o%s}}} %{fvtable-verify=none:%s;fvtable-verify=preinit:vtv_end.o%s;fvtable-verify=std:vtv_end.o%s} crtend.o%s\n\n";
    std::fs::write(&specs_path, specs_content).unwrap();

    println!("cargo:rustc-link-arg-bins=-specs={}", specs_path);
    std::env::set_var("PATH", format!("{};{}", mingw_bin, std::env::var("PATH").unwrap_or_default()));

    // Laat tauri_build alle ACL/capabilities/config genereren
    tauri_build::build();

    // Exact 874 bytes (geen null-byte!)
    let manifest_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0" xmlns:asmv3="urn:schemas-microsoft-com:asm.v3">
  <asmv3:application>
    <asmv3:windowsSettings xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">
      <longPathAware>true</longPathAware>
    </asmv3:windowsSettings>
  </asmv3:application>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
</assembly>"#;
    std::fs::write(&manifest_xml_path, manifest_xml).unwrap();

    // Manifest + programma-icoon (G+). ID 32512 is waar Tauri het standaard venstericoon zoekt;
    // Verkenner en de taakbalk gebruiken het eerste icoon in de exe.
    let icon_path = format!("{}/icons/icon.ico", std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .replace('\\', "/");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    let clean_rc = format!(
        "#pragma code_page(65001)\n1 24 \"{}\"\n32512 ICON \"{}\"\n",
        manifest_xml_path, icon_path
    );
    std::fs::write(&clean_rc_path, clean_rc).unwrap();

    let obj_path = format!("{}/gmeer_clean_res.o", out_dir);
    let lib_path = format!("{}/libresource.a", out_dir);

    let s1 = std::process::Command::new(format!(r"{}\windres.exe", mingw_bin))
        .args([&clean_rc_path, "-O", "coff", "-o", &obj_path])
        .status()
        .expect("Failed to run windres");
    assert!(s1.success());

    let _ = std::fs::remove_file(&lib_path);
    let _ = std::process::Command::new(format!(r"{}\ar.exe", mingw_bin))
        .args(["cr", &lib_path])
        .status();

    println!("cargo:rustc-link-arg-bins={}", obj_path);
}
