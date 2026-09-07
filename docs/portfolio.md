---
jinja: true
---

# Portfolio

受賞歴・主催イベントは `data/awards.yml` と `data/events.yml` が唯一の情報源で、
トップページと同じデータをここでも描画している。

## 受賞歴

{% set has_year = config.extra.awards | selectattr("year", "defined") | list | length > 0 -%}
| {% if has_year %}年 | {% endif %}コンテスト名 | 結果 |
|{% if has_year %}----|{% endif %}-------------|------|
{% for a in config.extra.awards -%}
| {% if has_year %}{{ a.year | default("") }} | {% endif %}{% if a.url %}[{{ a.name }}]({{ a.url }}){% else %}{{ a.name }}{% endif %} | {{ a.detail }} |
{% endfor %}
## 主催イベント
{% for e in config.extra.events %}
### {{ e.name }}
{% if e.motto %}
> {{ e.motto }}
{% endif %}
{{ e.desc.strip() }}
{% endfor %}
