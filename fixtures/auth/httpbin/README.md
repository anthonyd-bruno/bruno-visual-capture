# auth/httpbin

Three requests against `httpbin.org` whose responses prove the auth was applied: `/bearer` answers 200 with the
token it received, `/basic-auth/demo/secret` answers 200 only for those credentials, and `/headers` echoes the
request headers (so an API key header is visible in the response). All requests start with `auth: inherit` and
the collection has no auth, so the workflows add it live.
