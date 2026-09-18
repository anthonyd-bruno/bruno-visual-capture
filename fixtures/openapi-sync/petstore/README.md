# openapi-sync/petstore

`collection/` is a small YAML collection; `spec/openapi.yaml` describes the same endpoints and
`spec/openapi.v2.yaml` adds `/posts` and changes `/users/{id}`. The OpenAPI Sync workflow connects
the collection to `spec/openapi.yaml`, then copies v2 over it to produce the "changes detected" state.
