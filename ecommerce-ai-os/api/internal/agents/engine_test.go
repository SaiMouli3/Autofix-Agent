package agents

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/seed"
)

func TestRunReport(t *testing.T) {
	ds := seed.Generate(model.Store{ID: "st_demo", BusinessType: "fashion"}, time.Now())
	for _, key := range []string{"today", "yesterday", "7d", "30d", "90d"} {
		start := time.Now()
		rep := Run(ds, analytics.ParseRange(key, "", "", ds.Now))
		t.Logf("range %s: %v", key, time.Since(start))
		if key != "30d" {
			continue
		}
		for _, s := range rep.Summaries() {
			t.Logf("%-10s health=%3.0f prev=%3.0f status=%s issues=%d opps=%d headline=%v", s.ID, s.Health, s.HealthPrev, s.Status, s.Issues, s.Opportunities, s.Headline.Value)
		}
		for _, b := range rep.Business {
			t.Logf("BI [%s] %s (%s) src=%v", b.Severity, b.Title, USD(b.ImpactValue), b.Sources)
		}
		for _, id := range AgentOrder {
			for _, in := range rep.Results[id].Insights {
				t.Logf("  %s [%s] %s — %s", id, in.Severity, in.Title, in.Summary)
			}
		}
		h, hp, segs := rep.Health()
		t.Logf("health %.0f prev %.0f %+v", h, hp, segs)
		k := OverviewKPIs(ds, rep.Range, rep.Results["finance"], rep.Results["marketing"])
		for _, x := range k {
			t.Logf("KPI %s %.2f prev %.2f ch %.1f", x.Label, x.Value, x.Prev, x.Change)
		}
		b, err := json.Marshal(rep.Results)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("json size %d", len(b))
		for _, a := range rep.Activity(8) {
			t.Logf("%s %s %s", a.At.Format("15:04"), a.AgentID, a.Message)
		}
	}
}
