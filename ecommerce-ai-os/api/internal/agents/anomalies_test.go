package agents

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/seed"
)

// TestSeededAnomaliesDetected verifies that every anomaly woven into the raw
// demo data is surfaced by the responsible agent, across seeds and catalogs.
func TestSeededAnomaliesDetected(t *testing.T) {
	types := []string{"fashion", "electronics", "beauty", "home", "grocery", "d2c"}
	for i, bt := range types {
		for k := 0; k < 2; k++ {
			id := fmt.Sprintf("st_test_%d_%d", i, k)
			ds := seed.Generate(model.Store{ID: id, BusinessType: bt}, time.Now())
			rep := Run(ds, analytics.ParseRange("30d", "", "", ds.Now))
			has := func(agent string, pred func(Insight) bool) bool {
				for _, in := range rep.Results[agent].Insights {
					if pred(in) {
						return true
					}
				}
				return false
			}
			checks := map[string]bool{
				"product returns spike": has("products", func(in Insight) bool { return in.Severity == SevCritical && strings.Contains(in.Title, "return rate") }),
				"courier deterioration": has("orders", func(in Insight) bool {
					return in.Entity != nil && in.Entity.ID == "Swiftline" && strings.Contains(in.Entity.Name, "East")
				}),
				"stockout risk": has("inventory", func(in Insight) bool { return in.Severity == SevCritical }),
				"campaign ROAS drop": has("marketing", func(in Insight) bool {
					return in.Entity != nil && in.Entity.ID == "CMP-06" && strings.Contains(in.Title, "ROAS dropped")
				}),
				"competitor price cut":  has("pricing", func(in Insight) bool { return in.Severity == SevMarket }),
				"negative review surge": has("reviews", func(in Insight) bool { return in.Severity == SevCritical }),
				"payment failure spike": has("finance", func(in Insight) bool { return strings.Contains(in.Title, "Payment failure") }),
			}
			for name, ok := range checks {
				if !ok {
					t.Errorf("%s (%s): %s not detected", id, bt, name)
				}
			}
			quality := false
			for _, b := range rep.Business {
				if strings.HasPrefix(b.Title, "Potential product-quality issue") && len(b.Sources) == 3 {
					quality = true
				}
			}
			if !quality {
				t.Errorf("%s (%s): business insights did not connect the product-quality signals", id, bt)
			}
		}
	}
}
