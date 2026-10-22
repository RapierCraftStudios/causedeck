# Mock provider fixtures

Synthetic responses for the mock AI provider, one JSON file per `(task, sha256(normalised input))`:

```
fixtures/mock/<task>/<sha256>.json   { "output": <task output>, "usage"?: { "inputTokens": 0, "outputTokens": 0 } }
```

Inputs here are invented. Never record a real customer document: `withRecording` writes only for
inputs the caller marks synthetic. With no matching fixture the mock returns a schema-valid
synthetic value.
