# runner/basic-workspace

Bundled fixture for the Runner workflows. `collection/` is a Bruno 4.x YAML-format collection with
four GET requests against the public `jsonplaceholder.typicode.com` API (chosen explicitly — PRD §46
allows real external APIs when the workflow says so; a mock-server variant comes with the mock-server
feature area). The whole directory is copied into a temp run workspace before use (PRD §44).
