package seed

import (
	"testing"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

func TestGenerate(t *testing.T) {
	for _, bt := range []string{"fashion", "electronics", "beauty", "home", "grocery", "d2c"} {
		start := time.Now()
		ds := Generate(model.Store{ID: "st_demo_" + bt, BusinessType: bt}, time.Now())
		t.Logf("%s: %v products=%d customers=%d orders=%d ship=%d returns=%d refunds=%d reviews=%d tickets=%d comp=%d news=%d",
			bt, time.Since(start), len(ds.Products), len(ds.Customers), len(ds.Orders), len(ds.Shipments), len(ds.Returns), len(ds.Refunds), len(ds.Reviews), len(ds.Tickets), len(ds.CompPrices), len(ds.News))
		if len(ds.Orders) < 15000 || len(ds.Customers) < 5000 || len(ds.Reviews) < 1000 || len(ds.Tickets) < 500 || len(ds.Products) < 100 {
			t.Errorf("%s: dataset below target sizes", bt)
		}
	}
}
