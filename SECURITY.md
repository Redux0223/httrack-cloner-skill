# Security Policy

## Reporting a vulnerability

Please do not open a public issue for credential exposure, path traversal, arbitrary file access, command injection, or sandbox escape findings.

Use GitHub's private vulnerability reporting for this repository. Include:

- affected script and version or commit;
- a minimal reproduction using synthetic or authorized content;
- expected and observed behavior;
- impact and suggested mitigation, when known.

## Security boundaries

The project processes untrusted HTML, CSS, JavaScript, JSON, media paths, and HTTrack output. Important boundaries include:

- capture host allowlists;
- output/input overlap prevention;
- symlink rejection;
- restricted atomic writes;
- credential and tracker sanitization;
- local-only preview and source-oracle registration;
- automatic external request detection.

Only run it against content you are authorized to access and process.
