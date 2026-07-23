{{ range .Versions }}
<a name="{{ .Tag.Name }}"></a>
## [{{ .Tag.Name }}] — {{ datetime "2006-01-02" .Tag.Date }}
{{ range .CommitGroups }}
### {{ .Title }}
{{ range .Commits }}
- {{ if .Scope }}**{{ .Scope }}**: {{ end }}{{ .Subject }} ([`{{ .Hash.Short }}`]){{ end }}
{{ end }}{{ end }}
