// Package seed generates a realistic, internally consistent demo store.
//
// Every number shown in the product is derived from these raw records:
// returns reference real delivered orders, reviews reference real customers
// and products, inventory is reconstructed from actual unit sales, campaign
// revenue is the revenue of orders attributed to the campaign, and so on.
//
// Five business anomalies are woven into the raw data (not into any metric)
// so that the agents have something real to detect:
//
//  1. Product X: returns, sizing/quality complaints and negative reviews spike
//  2. Competitor A drops its price on a key product by 12%
//  3. Product Y: high velocity, missed restock, projected stockout
//  4. Marketing: one Meta campaign's ROAS collapses (spend up, conversions down)
//  5. Delivery: one courier deteriorates in the East region
package seed

import (
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strings"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

// IST is used for all business-day boundaries.
var IST = time.FixedZone("IST", 5*3600+1800)

const Days = 180

func StartOfDay(t time.Time) time.Time {
	t = t.In(IST)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, IST)
}

type gen struct {
	r     *rand.Rand
	cg    catalog
	ds    *model.Dataset
	now   time.Time
	today time.Time
	start time.Time

	prodWeights [][]float64 // per day cumulative weights
	prodQuality []float64
	prodCat     []int
	idxX, idxY  int
	idxPA       int

	geoCum []float64

	custPool []int // indices into Customers, repeated by loyalty
	custGeo  []int

	campaignShare []float64
	campaignROAS  []float64

	soldByDay  [][]int // product -> day -> units
	ordersDay  []int   // day -> number of orders
	prepaidDay []int

	nextReturn, nextRefund, nextReview, nextTicket int
}

// Generate builds a complete dataset for the store, anchored at now.
func Generate(store model.Store, now time.Time) *model.Dataset {
	seed := int64(0)
	for _, c := range store.ID {
		seed = seed*31 + int64(c)
	}
	g := &gen{
		r:     rand.New(rand.NewSource(seed ^ 0x5eed)),
		cg:    catalogFor(store.BusinessType),
		now:   now.In(IST),
		today: StartOfDay(now),
	}
	g.start = g.today.AddDate(0, 0, -(Days - 1))
	if store.Name == "" {
		store.Name = g.cg.StoreName
	}
	g.ds = &model.Dataset{Store: store, Now: g.now}

	g.products()
	g.campaigns()
	g.geography()
	g.legacyCustomers()
	g.orders()
	g.fulfilment()
	g.inventory()
	g.marketingMetrics()
	g.competitors()
	g.finance()
	g.news()
	g.ds.Index()
	return g.ds
}

// ---------------------------------------------------------------- helpers

func (g *gen) day(d int) time.Time { return g.start.AddDate(0, 0, d) }

func (g *gen) dayIndex(t time.Time) int {
	return int(StartOfDay(t).Sub(g.start).Hours() / 24)
}

func (g *gen) uniform(a, b float64) float64 { return a + g.r.Float64()*(b-a) }

func (g *gen) chance(p float64) bool { return g.r.Float64() < p }

func (g *gen) pick(cum []float64) int {
	x := g.r.Float64() * cum[len(cum)-1]
	return sort.SearchFloat64s(cum, x)
}

func cumulative(w []float64) []float64 {
	c := make([]float64, len(w))
	s := 0.0
	for i, v := range w {
		s += v
		c[i] = s
	}
	return c
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func roundPrice(v float64) float64 {
	// US retail price points end in .99 (half-dollar steps for low prices).
	step := 1.0
	if v < 10 {
		step = 0.5
	}
	return round2(math.Max(2.99, math.Round(v/step)*step-0.01))
}

func (g *gen) normal(mean, sd float64) float64 { return mean + g.r.NormFloat64()*sd }

// ---------------------------------------------------------------- products

func (g *gen) products() {
	cg := g.cg
	used := map[string]bool{}
	idx := 0
	for ci, cat := range cg.Categories {
		names := []string{}
		for _, a := range []anchor{cg.QualityIssue, cg.Stockout, cg.PriceAttacked} {
			if a.Category == ci {
				names = append(names, a.Name)
				used[a.Name] = true
			}
		}
		for len(names) < cat.Count {
			n := fmt.Sprintf("%s %s %s", cg.Lines[g.r.Intn(len(cg.Lines))], cat.Styles[g.r.Intn(len(cat.Styles))], cat.Items[g.r.Intn(len(cat.Items))])
			if used[n] {
				continue
			}
			used[n] = true
			names = append(names, n)
		}
		prefix := strings.ToUpper(cg.StoreName[:2])
		catCode := strings.ToUpper(strings.ReplaceAll(cat.Name, " ", ""))
		if len(catCode) > 3 {
			catCode = catCode[:3]
		}
		for _, n := range names {
			price := roundPrice(g.uniform(cat.PriceMin, cat.PriceMax))
			p := model.Product{
				ID:         fmt.Sprintf("P-%d", 1001+idx),
				StoreID:    g.ds.Store.ID,
				SKU:        fmt.Sprintf("%s-%s-%d", prefix, catCode, 1001+idx),
				Name:       n,
				Category:   cat.Name,
				Price:      price,
				Cost:       round2(price * cat.CostRatio * g.uniform(0.9, 1.1)),
				Supplier:   cg.Suppliers[g.r.Intn(len(cg.Suppliers))],
				LaunchedAt: g.today.AddDate(0, 0, -g.r.Intn(700)-Days/3),
			}
			switch n {
			case cg.QualityIssue.Name:
				g.idxX = idx
				p.Supplier = cg.Suppliers[0]
			case cg.Stockout.Name:
				g.idxY = idx
			case cg.PriceAttacked.Name:
				g.idxPA = idx
			}
			g.ds.Products = append(g.ds.Products, p)
			g.prodCat = append(g.prodCat, ci)
			g.prodQuality = append(g.prodQuality, g.uniform(3.9, 4.7))
			idx++
		}
	}
	n := len(g.ds.Products)

	// Popularity: a long-tail rank distribution, with growth/decline trends.
	ranks := g.r.Perm(n)
	base := make([]float64, n)
	growth := make([]float64, n)
	for i := range base {
		base[i] = 1 / math.Pow(float64(ranks[i]+3), 0.85)
		growth[i] = g.uniform(-0.35, 0.55)
	}
	base[g.idxX], growth[g.idxX] = 1.3/math.Pow(3, 0.85), 0.25
	base[g.idxY], growth[g.idxY] = 1/math.Pow(5, 0.85), 0.9
	base[g.idxPA], growth[g.idxPA] = 1/math.Pow(6, 0.85), 0.2
	g.prodQuality[g.idxX] = 4.4
	// A handful of strong growers and decliners for the product agent.
	for k, i := range g.r.Perm(n)[:12] {
		if i == g.idxX || i == g.idxY || i == g.idxPA {
			continue
		}
		switch {
		case k < 4:
			growth[i] = g.uniform(1.4, 2.4) // fast-growing
		case k < 8:
			growth[i] = g.uniform(-0.75, -0.6) // declining
		default:
			growth[i] = -1.2 // effectively dead stock
			g.prodQuality[i] = g.uniform(3.4, 3.8)
		}
	}
	g.prodWeights = make([][]float64, Days)
	for d := 0; d < Days; d++ {
		w := make([]float64, n)
		frac := float64(d) / float64(Days-1)
		for i := range w {
			w[i] = base[i] * math.Max(0.003, 1+growth[i]*frac)
		}
		// Competitor A undercut: our matched product loses share in the last 4 days.
		if d >= Days-4 {
			w[g.idxPA] *= 0.74
		}
		g.prodWeights[d] = cumulative(w)
	}
	g.soldByDay = make([][]int, n)
	for i := range g.soldByDay {
		g.soldByDay[i] = make([]int, Days)
	}
	g.ordersDay = make([]int, Days)
	g.prepaidDay = make([]int, Days)
}

// ---------------------------------------------------------------- campaigns

type campaignDef struct {
	channel, name, objective string
	share, roas              float64
}

var campaignDefs = []campaignDef{
	{"google", "Search — Brand", "Capture branded demand", 13, 9.5},
	{"google", "Search — Non-brand Category", "Acquire category searchers", 8, 3.1},
	{"google", "Performance Max — Catalog", "Scale catalog sales", 9, 3.6},
	{"meta", "Retargeting — Cart Abandoners", "Recover abandoned carts", 8, 5.2},
	{"meta", "Prospecting — Lookalike 2%", "Acquire new customers", 7, 2.7},
	{"meta", "Festive Prospecting — Broad", "Seasonal acquisition", 6, 2.9},
	{"instagram", "Reels — Creator Collab", "Awareness to purchase", 6, 2.5},
	{"instagram", "Stories — New Arrivals", "Launch new arrivals", 4, 2.8},
	{"email", "Weekly Newsletter", "Engage subscribers", 6, 38},
	{"email", "Abandoned Cart Flow", "Recover abandoned carts", 5, 52},
	{"whatsapp", "Broadcast — Restock Alerts", "Notify on restocks", 4, 24},
	{"whatsapp", "Win-back — 60-day Lapsed", "Re-activate lapsed customers", 3, 19},
}

const organicShare = 21.0
const festiveCampaign = 5

func (g *gen) campaigns() {
	for i, c := range campaignDefs {
		g.ds.Campaigns = append(g.ds.Campaigns, model.Campaign{
			ID:        fmt.Sprintf("CMP-%02d", i+1),
			Channel:   c.channel,
			Name:      c.name,
			Objective: c.objective,
			Status:    "active",
			StartedAt: g.start.AddDate(0, 0, -g.r.Intn(120)),
		})
		g.campaignShare = append(g.campaignShare, c.share)
		g.campaignROAS = append(g.campaignROAS, c.roas)
	}
}

// ---------------------------------------------------------------- customers

func (g *gen) geography() {
	w := make([]float64, len(geos))
	for i, x := range geos {
		w[i] = x.Weight
	}
	g.geoCum = cumulative(w)
}

func (g *gen) newCustomer(created time.Time) int {
	gi := g.pick(g.geoCum)
	geo := geos[gi]
	fn := firstNames[g.r.Intn(len(firstNames))]
	ln := lastNames[g.r.Intn(len(lastNames))]
	id := len(g.ds.Customers)
	email := fmt.Sprintf("%s.%s%d@mail.example", strings.ToLower(fn), strings.ToLower(strings.ReplaceAll(ln, "'", "")), 10+id%990)
	g.ds.Customers = append(g.ds.Customers, model.Customer{
		ID:        fmt.Sprintf("C-%d", 10001+id),
		StoreID:   g.ds.Store.ID,
		Name:      fn + " " + ln,
		Email:     email,
		Phone:     fmt.Sprintf("+91 9%04d %05d", g.r.Intn(10000), g.r.Intn(100000)),
		City:      geo.Cities[g.r.Intn(len(geo.Cities))],
		State:     geo.State,
		Region:    geo.Region,
		CreatedAt: created,
	})
	g.custGeo = append(g.custGeo, gi)
	return id
}

func (g *gen) legacyCustomers() {
	for i := 0; i < 1500; i++ {
		created := g.start.AddDate(0, 0, -g.r.Intn(640)-15).Add(time.Duration(g.r.Intn(86400)) * time.Second)
		id := g.newCustomer(created)
		tickets := 1
		switch x := g.r.Float64(); {
		case x < 0.09:
			tickets = 7 // VIP
		case x < 0.32:
			tickets = 3 // loyal
		}
		for k := 0; k < tickets; k++ {
			g.custPool = append(g.custPool, id)
		}
	}
}

// ---------------------------------------------------------------- orders

var hourWeights = cumulative([]float64{1, 0.6, 0.4, 0.3, 0.3, 0.5, 1, 2, 3, 4, 4.5, 5, 5.5, 5, 4.5, 4.5, 5, 5.5, 6.5, 7.5, 8.5, 8, 6, 3})

func (g *gen) orders() {
	nextOrder := 100001
	for d := 0; d < Days; d++ {
		date := g.day(d)
		frac := float64(d) / float64(Days-1)
		volume := 66 + 42*frac
		switch date.Weekday() {
		case time.Saturday, time.Sunday:
			volume *= 1.16
		case time.Monday:
			volume *= 0.94
		}
		festive := d >= Days-62 && d <= Days-49
		if festive {
			volume *= 1.65
		}
		volume *= g.uniform(0.9, 1.1)
		n := int(volume)
		if d == Days-1 {
			elapsed := g.now.Sub(date).Hours() / 24
			n = int(float64(n) * elapsed * 1.05)
		}

		// Daily campaign share (with the Festive Prospecting collapse).
		shares := append([]float64(nil), g.campaignShare...)
		shares = append(shares, organicShare)
		if d >= Days-7 {
			shares[festiveCampaign] = 2.1
		}
		if festive {
			shares[festiveCampaign] = 11
		}
		campCum := cumulative(shares)

		for k := 0; k < n; k++ {
			at := date.Add(time.Duration(g.pick(hourWeights))*time.Hour + time.Duration(g.r.Intn(3600))*time.Second)
			if at.After(g.now) {
				continue
			}
			// Customer: repeat buyers come from the loyalty-weighted pool.
			pRepeat := math.Min(0.5, 0.33+float64(len(g.custPool))/40000)
			var ci int
			if len(g.custPool) > 0 && g.chance(pRepeat) {
				ci = g.custPool[g.r.Intn(len(g.custPool))]
			} else {
				ci = g.newCustomer(at.Add(-time.Duration(g.r.Intn(1800)) * time.Second))
				if g.chance(0.52) {
					g.custPool = append(g.custPool, ci)
					if g.chance(0.1) {
						g.custPool = append(g.custPool, ci, ci, ci)
					}
				}
			}
			cust := g.ds.Customers[ci]
			// Items
			nItems := 1
			if x := g.r.Float64(); x < 0.24 {
				nItems = 2
			} else if x < 0.31 {
				nItems = 3
			}
			o := model.Order{
				ID:         fmt.Sprintf("O-%d", nextOrder),
				StoreID:    g.ds.Store.ID,
				Number:     fmt.Sprintf("#%s%d", strings.ToUpper(g.cg.StoreName[:2]), nextOrder),
				CustomerID: cust.ID,
				CreatedAt:  at,
			}
			nextOrder++
			seen := map[int]bool{}
			for it := 0; it < nItems; it++ {
				pi := g.pick(g.prodWeights[d])
				if seen[pi] {
					continue
				}
				seen[pi] = true
				p := g.ds.Products[pi]
				qty := 1
				if g.chance(0.08) {
					qty = 2
				}
				o.Items = append(o.Items, model.OrderItem{OrderID: o.ID, ProductID: p.ID, Qty: qty, UnitPrice: p.Price, UnitCost: p.Cost})
				o.Subtotal += p.Price * float64(qty)
			}
			// Discounts
			switch {
			case festive && g.chance(0.62):
				o.Discount = round2(o.Subtotal * g.uniform(0.12, 0.22))
			case g.chance(0.24):
				o.Discount = round2(o.Subtotal * 0.1)
			}
			if o.Subtotal-o.Discount < 35 {
				o.ShippingFee = 4.99
			}
			o.Total = round2(o.Subtotal - o.Discount + o.ShippingFee)
			// Payment
			pCOD := 0.4
			if r := geos[g.custGeo[ci]].Region; r == "East" || r == "Northeast" || r == "Central" {
				pCOD = 0.55
			}
			o.PaymentMethod = "prepaid"
			if g.chance(pCOD) {
				o.PaymentMethod = "cod"
			} else {
				g.prepaidDay[d]++
			}
			// Attribution
			c := g.pick(campCum)
			if c < len(g.ds.Campaigns) {
				o.CampaignID = g.ds.Campaigns[c].ID
				o.Channel = g.ds.Campaigns[c].Channel
			} else if g.chance(0.6) {
				o.Channel = "organic"
			} else {
				o.Channel = "direct"
			}
			o.Status = model.OrderProcessing
			g.ds.Orders = append(g.ds.Orders, o)
			g.ordersDay[d]++
			for _, it := range o.Items {
				var pi int
				fmt.Sscanf(it.ProductID, "P-%d", &pi)
				g.soldByDay[pi-1001][d] += it.Qty
			}
		}
	}
}

// ---------------------------------------------------------------- fulfilment

var regionTransit = map[string][2]float64{
	"West": {2, 4}, "South": {2, 4}, "North": {2, 5}, "East": {3, 6}, "Central": {3, 6}, "Northeast": {4, 8},
}
var regionSLA = map[string]int{"West": 5, "South": 5, "North": 5, "East": 6, "Central": 6, "Northeast": 8}
var courierModifier = map[string]float64{"Swiftline": -0.3, "BlueRoute": 0, "Parcelo": 0.5, "Northstar": 0.2, "Dashway": 0.8}

var reasonsFit = []string{"Size runs small", "Size runs large", "Quality not as expected", "Damaged in transit", "Wrong item received", "Changed mind", "Looks different from photos"}
var reasonsFitW = cumulative([]float64{24, 12, 18, 8, 5, 22, 11})
var reasonsStd = []string{"Quality not as expected", "Damaged in transit", "Wrong item received", "Changed mind", "Looks different from photos", "Stopped working"}
var reasonsStdW = cumulative([]float64{26, 16, 8, 26, 12, 12})

func (g *gen) fulfilment() {
	courierCum := cumulative(courierWeight)
	custIdx := map[string]int{}
	for i, c := range g.ds.Customers {
		custIdx[c.ID] = i
	}
	for oi := range g.ds.Orders {
		o := &g.ds.Orders[oi]
		ci := custIdx[o.CustomerID]
		cust := g.ds.Customers[ci]
		region := cust.Region
		cod := o.PaymentMethod == "cod"
		ageDays := g.now.Sub(o.CreatedAt).Hours() / 24

		// Cancellations happen before dispatch.
		pCancel := 0.028
		if cod {
			pCancel = 0.048
		}
		if g.chance(pCancel) {
			o.Status = model.OrderCancelled
			if !cod {
				g.addRefund(o.ID, "", o.Total, "Order cancelled", o.CreatedAt.Add(time.Duration(2+g.r.Intn(30))*time.Hour))
			}
			if g.chance(0.12) {
				g.addTicket(o, "", "Order change", false, o.CreatedAt.Add(30*time.Minute), "")
			}
			continue
		}

		courier := couriers[g.pick(courierCum)]
		// Swiftline is the primary carrier for the East.
		if region == "East" && g.chance(0.3) {
			courier = "Swiftline"
		}
		sla := regionSLA[region]
		sh := model.Shipment{
			OrderID:    o.ID,
			Courier:    courier,
			State:      cust.State,
			Region:     region,
			PromisedAt: o.CreatedAt.AddDate(0, 0, sla),
			Status:     model.OrderProcessing,
			Cost:       round2(g.uniform(1.8, 2.9)),
		}
		shipped := o.CreatedAt.Add(time.Duration(4+g.r.Intn(36)) * time.Hour)
		if shipped.After(g.now) {
			g.ds.Shipments = append(g.ds.Shipments, sh)
			continue
		}
		sh.ShippedAt = &shipped
		tr := regionTransit[region]
		transit := g.uniform(tr[0], tr[1]) + courierModifier[courier]
		pNDR := 0.045
		pRefuse := 0.008
		if cod {
			pNDR, pRefuse = 0.085, 0.04
		}
		// Anomaly 5: Swiftline deteriorates in the East over the last 12 days.
		eastIncident := courier == "Swiftline" && region == "East" && ageDays <= 16
		if eastIncident {
			transit += g.uniform(1.6, 3.6)
			pNDR *= 2.6
			pRefuse *= 2.2
		}
		// Recent COD refusals tick up (RTO trend this week).
		if cod && ageDays <= 7 {
			pRefuse += 0.03
		}
		deliveredAt := shipped.Add(time.Duration(transit*24) * time.Hour)
		status := model.OrderDelivered
		if g.chance(pNDR) {
			sh.NDRAttempts = 1 + g.r.Intn(3)
			pRTO := 0.3
			if cod {
				pRTO = 0.48
			}
			if g.chance(pRTO) {
				status = model.OrderRTO
				sh.Cost *= 2
			} else {
				deliveredAt = deliveredAt.Add(time.Duration(24*(1+sh.NDRAttempts)) * time.Hour)
			}
			// NDR still pending if the attempt window hasn't closed yet.
			if deliveredAt.After(g.now) && shipped.Add(time.Duration(transit*24)*time.Hour).Before(g.now) {
				status = model.OrderNDR
			}
		} else if g.chance(pRefuse) {
			status = model.OrderRTO
			sh.Cost *= 2
		}
		if status == model.OrderDelivered && deliveredAt.After(g.now) {
			status = model.OrderShipped
		}
		if status == model.OrderRTO && deliveredAt.After(g.now) {
			status = model.OrderShipped
			if sh.NDRAttempts > 0 {
				status = model.OrderNDR
			}
		}
		sh.Status = status
		o.Status = status
		if status == model.OrderDelivered {
			da := deliveredAt
			sh.DeliveredAt = &da
		}
		if status == model.OrderRTO && !cod {
			g.addRefund(o.ID, "", o.Total, "Returned to origin", deliveredAt.Add(72*time.Hour))
		}
		g.ds.Shipments = append(g.ds.Shipments, sh)

		late := sh.DeliveredAt != nil && sh.DeliveredAt.Sub(sh.PromisedAt).Hours() > 24
		stuck := (status == model.OrderShipped || status == model.OrderNDR) && g.now.After(sh.PromisedAt)
		cluster := ""
		if eastIncident {
			cluster = "delivery-east-swiftline"
		}
		if late || stuck {
			p := 0.16
			if eastIncident {
				p = 0.55
			}
			if g.chance(p) {
				at := sh.PromisedAt.Add(time.Duration(2+g.r.Intn(30)) * time.Hour)
				if at.Before(g.now) {
					g.addTicket(o, "", "Delivery delay", true, at, cluster)
				}
			}
		}
		if sh.NDRAttempts > 0 && (g.chance(0.18) || eastIncident && g.chance(0.3)) {
			at := shipped.Add(time.Duration(transit*24+6) * time.Hour)
			if at.Before(g.now) {
				g.addTicket(o, "", "Failed delivery attempt", true, at, cluster)
			}
		}

		if status == model.OrderDelivered {
			g.postDelivery(o, *sh.DeliveredAt, eastIncident)
		}
		if !cod && g.chance(0.004) {
			g.addTicket(o, "", "Payment issue", true, o.CreatedAt.Add(20*time.Minute), "")
		}
		if g.chance(0.006) {
			g.addTicket(o, "", "Product enquiry", false, o.CreatedAt.Add(-2*time.Hour), "")
		}
	}
}

func (g *gen) productIndex(id string) int {
	var n int
	fmt.Sscanf(id, "P-%d", &n)
	return n - 1001
}

func (g *gen) postDelivery(o *model.Order, delivered time.Time, lateIncident bool) {
	sinceDelivery := g.now.Sub(delivered).Hours() / 24
	for _, it := range o.Items {
		pi := g.productIndex(it.ProductID)
		cat := g.cg.Categories[g.prodCat[pi]]
		p := cat.ReturnRate * (1 + (4.3-g.prodQuality[pi])*0.6)
		anomalyX := pi == g.idxX && sinceDelivery <= 22
		if anomalyX {
			p = math.Max(0.24, p*3)
		}
		if g.chance(p) {
			at := delivered.Add(time.Duration(24+g.r.Intn(130)) * time.Hour)
			if at.Before(g.now) {
				var reason string
				switch {
				case anomalyX && cat.FitSensitive:
					reason = []string{"Size runs small", "Size runs small", "Size runs small", "Quality not as expected", "Quality not as expected", "Changed mind"}[g.r.Intn(6)]
				case anomalyX:
					reason = []string{"Quality not as expected", "Quality not as expected", "Quality not as expected", "Stopped working", "Damaged in transit", "Changed mind"}[g.r.Intn(6)]
				case cat.FitSensitive:
					reason = reasonsFit[g.pick(reasonsFitW)]
				default:
					reason = reasonsStd[g.pick(reasonsStdW)]
				}
				g.addReturn(o, it, reason, at, anomalyX)
			}
		}
	}
	// Reviews
	pReview := 0.082
	pi := g.productIndex(o.Items[0].ProductID)
	for _, it := range o.Items {
		if g.productIndex(it.ProductID) == g.idxX {
			pi = g.idxX
		}
	}
	anomalyX := pi == g.idxX && sinceDelivery <= 18
	if anomalyX {
		pReview = 0.22
	}
	if g.chance(pReview) {
		at := delivered.Add(time.Duration(20+g.r.Intn(200)) * time.Hour)
		if at.Before(g.now) {
			g.addReview(o, pi, at, anomalyX, lateIncident)
		}
	}
}

func (g *gen) addReturn(o *model.Order, it model.OrderItem, reason string, at time.Time, anomalyX bool) {
	g.nextReturn++
	id := fmt.Sprintf("RT-%d", 3000+g.nextReturn)
	status := "requested"
	age := g.now.Sub(at).Hours() / 24
	switch {
	case age > 7:
		status = "refunded"
	case age > 4:
		status = "received"
	case age > 1:
		status = "approved"
	}
	g.ds.Returns = append(g.ds.Returns, model.Return{ID: id, OrderID: o.ID, ProductID: it.ProductID, Qty: it.Qty, Reason: reason, CreatedAt: at, Status: status})
	if status == "refunded" {
		g.addRefund(o.ID, id, it.UnitPrice*float64(it.Qty), "Return: "+reason, at.Add(time.Duration(72+g.r.Intn(96))*time.Hour))
	}
	o.Status = model.OrderReturned
	// Return-related support contacts.
	switch {
	case anomalyX && g.chance(0.72):
		cat := "Product quality"
		if strings.HasPrefix(reason, "Size") {
			cat = "Sizing issue"
		}
		g.addTicket(o, it.ProductID, cat, true, at.Add(-3*time.Hour), "quality-x")
	case reason == "Damaged in transit" && g.chance(0.6):
		g.addTicket(o, it.ProductID, "Damaged item", true, at.Add(-2*time.Hour), "")
	case reason == "Quality not as expected" && g.chance(0.3):
		g.addTicket(o, it.ProductID, "Product quality", true, at.Add(-2*time.Hour), "")
	case g.chance(0.18):
		g.addTicket(o, it.ProductID, "Return & refund", false, at.Add(time.Duration(48+g.r.Intn(96))*time.Hour), "")
	}
}

func (g *gen) addRefund(orderID, returnID string, amount float64, reason string, at time.Time) {
	if at.After(g.now) {
		return
	}
	g.nextRefund++
	g.ds.Refunds = append(g.ds.Refunds, model.Refund{ID: fmt.Sprintf("RF-%d", 7000+g.nextRefund), OrderID: orderID, ReturnID: returnID, Amount: round2(amount), Reason: reason, CreatedAt: at})
}

// ---------------------------------------------------------------- reviews

func (g *gen) addReview(o *model.Order, pi int, at time.Time, anomalyX, lateIncident bool) {
	q := g.prodQuality[pi]
	mean := q
	if anomalyX {
		mean = 2.3
	}
	if lateIncident {
		mean -= 0.9
	}
	rating := int(math.Round(g.normal(mean, 0.85)))
	rating = max(1, min(5, rating))
	p := g.ds.Products[pi]
	cat := g.cg.Categories[g.prodCat[pi]]
	item := strings.ToLower(itemNoun(p.Name, cat))

	var themes []string
	switch {
	case anomalyX && rating <= 3 && cat.FitSensitive:
		themes = []string{"Fit & sizing"}
		if g.chance(0.55) {
			themes = append(themes, "Quality")
		}
	case anomalyX && rating <= 3:
		themes = []string{"Quality"}
	case lateIncident && rating <= 3:
		themes = []string{"Delivery"}
	case rating <= 2:
		themes = []string{negThemes[g.pick(negThemeW)]}
		if !cat.FitSensitive && themes[0] == "Fit & sizing" {
			themes[0] = "Quality"
		}
	case rating == 3:
		themes = []string{[]string{"Price", "Quality", "Packaging", "Delivery"}[g.r.Intn(4)]}
	default:
		themes = []string{posThemes[g.pick(posThemeW)]}
		if !cat.FitSensitive && themes[0] == "Fit & sizing" {
			themes[0] = "Value"
		}
	}
	sentiment := "positive"
	if rating == 3 {
		sentiment = "neutral"
	} else if rating <= 2 {
		sentiment = "negative"
	}
	title, body := reviewText(g.r, sentiment, themes, item)
	sources := []string{"Store", "Store", "Store", "Google", "Instagram"}
	g.nextReview++
	cust := o.CustomerID
	r := model.Review{
		ID: fmt.Sprintf("RV-%d", 5000+g.nextReview), ProductID: p.ID, CustomerID: cust, OrderID: o.ID,
		Rating: rating, Title: title, Body: body, Source: sources[g.r.Intn(len(sources))],
		Sentiment: sentiment, Themes: themes, CreatedAt: at,
	}
	if sentiment == "negative" && g.now.Sub(at).Hours() > 96 && g.chance(0.55) {
		r.Response = "We're sorry this fell short. Our team has reached out to make it right."
	}
	g.ds.Reviews = append(g.ds.Reviews, r)
}

func itemNoun(name string, cat category) string {
	for _, it := range cat.Items {
		if strings.HasSuffix(name, it) {
			return it
		}
	}
	return "product"
}

var negThemes = []string{"Packaging", "Quality", "Delivery", "Price", "Support", "Fit & sizing"}
var negThemeW = cumulative([]float64{28, 26, 19, 11, 7, 9})
var posThemes = []string{"Quality", "Value", "Fit & sizing", "Delivery", "Packaging", "Design"}
var posThemeW = cumulative([]float64{30, 18, 14, 14, 10, 14})

var reviewBank = map[string]map[string][][2]string{
	"positive": {
		"Quality":      {{"Excellent quality", "The %s feels genuinely premium. Finishing is neat and it has held up well after regular use."}, {"Worth every penny", "Really impressed with the build of this %s. Better than what I expected at this price."}},
		"Value":        {{"Great value", "For the price this %s is hard to beat. Already recommended it to two friends."}, {"Good buy", "Bought the %s during the sale and it was a steal. Will buy again."}},
		"Fit & sizing": {{"Fits perfectly", "Followed the size chart and the %s fits exactly as expected. Comfortable all day."}, {"True to size", "The %s is true to size and the fit is flattering."}},
		"Delivery":     {{"Super fast delivery", "Ordered the %s on Monday and it arrived Wednesday. Smooth experience."}, {"Quick and safe", "The %s reached earlier than promised and was well protected."}},
		"Packaging":    {{"Lovely packaging", "The %s came in beautiful, plastic-free packaging. Felt like a gift."}, {"Neatly packed", "Very neat packaging and the %s was in perfect condition."}},
		"Design":       {{"Beautiful design", "The %s looks even better in person. Getting lots of compliments."}, {"Love the look", "Clean, thoughtful design on this %s. Exactly what I wanted."}},
	},
	"neutral": {
		"Price":     {{"Decent but pricey", "The %s is decent, but feels a little overpriced compared to similar options."}},
		"Quality":   {{"Okay quality", "The %s is fine for the price. Nothing exceptional."}},
		"Packaging": {{"Product fine, packaging meh", "The %s itself is okay but the box arrived a bit crushed."}},
		"Delivery":  {{"Took a while", "The %s is good but delivery took longer than the estimate."}},
	},
	"negative": {
		"Fit & sizing": {{"Size runs small", "Ordered my usual size but the %s is at least one size smaller. The size chart is misleading."}, {"Sizing is off", "The %s is much tighter than the listed measurements. Had to return it."}, {"Inconsistent sizing", "Two %ss in the same size fit completely differently. Quality control needs work."}},
		"Quality":      {{"Poor quality", "The %s started fraying after one wash. Not what I expect at this price."}, {"Disappointed with material", "The fabric of the %s feels thinner than earlier orders. Seems like the batch changed."}, {"Quality has dropped", "I've bought this %s before, but this one feels noticeably cheaper."}},
		"Delivery":     {{"Delivery was a mess", "The %s arrived 5 days late and the courier kept marking it as failed attempt."}, {"Very late", "Waited more than a week for the %s. No proactive update from the courier."}},
		"Packaging":    {{"Damaged packaging", "The box was torn and the %s inside was dirty. Poor packaging."}, {"Arrived damaged", "The %s arrived with a dent because the packaging was flimsy."}},
		"Price":        {{"Not worth the price", "The %s is overpriced. Found a similar one cheaper elsewhere."}},
		"Support":      {{"Support didn't help", "Raised a complaint about the %s, but support took 3 days to respond."}},
	},
}

func reviewText(r *rand.Rand, sentiment string, themes []string, item string) (string, string) {
	bank := reviewBank[sentiment][themes[0]]
	if len(bank) == 0 {
		bank = reviewBank[sentiment]["Quality"]
	}
	tpl := bank[r.Intn(len(bank))]
	body := fmt.Sprintf(tpl[1], item)
	if len(themes) > 1 {
		if extra := reviewBank[sentiment][themes[1]]; len(extra) > 0 {
			body += " " + fmt.Sprintf(extra[r.Intn(len(extra))][1], item)
		}
	}
	return tpl[0], body
}

// ---------------------------------------------------------------- support

var ticketChannels = []string{"WhatsApp", "Email", "Chat", "Phone"}
var ticketChannelW = cumulative([]float64{42, 26, 22, 10})

var ticketCopy = map[string][2]string{
	"Delivery delay":          {"Order %s still not delivered", "My order %s was supposed to arrive by now. Tracking hasn't updated in days. When will I get it?"},
	"Failed delivery attempt": {"Courier marked delivery failed for %s", "The courier marked %s as 'customer unavailable' but I was home all day. Please reschedule."},
	"Sizing issue":            {"Wrong size — %s", "The item in %s runs much smaller than the size chart. I need an exchange for a bigger size."},
	"Product quality":         {"Quality problem with %s", "The item in order %s has a quality defect. Material feels different from my last purchase."},
	"Damaged item":            {"Item damaged in %s", "My order %s arrived damaged. Sharing photos — please arrange a replacement."},
	"Return & refund":         {"Refund status for %s", "I returned items from %s last week. When will the refund be processed?"},
	"Payment issue":           {"Payment deducted, %s not confirmed", "Money was debited for %s but I didn't get a confirmation. Please check."},
	"Order change":            {"Change request for %s", "Can I change the address / cancel order %s?"},
	"Product enquiry":         {"Question before ordering", "Is the product in %s available in other colours? Also what is the return window?"},
}

func (g *gen) addTicket(o *model.Order, productID, category string, complaint bool, at time.Time, cluster string) {
	if at.After(g.now) {
		return
	}
	g.nextTicket++
	copy := ticketCopy[category]
	ch := ticketChannels[g.pick(ticketChannelW)]
	t := model.Ticket{
		ID:          fmt.Sprintf("TK-%d", 8000+g.nextTicket),
		CustomerID:  o.CustomerID,
		OrderID:     o.ID,
		ProductID:   productID,
		Channel:     ch,
		Category:    category,
		Subject:     fmt.Sprintf(copy[0], o.Number),
		Message:     fmt.Sprintf(copy[1], o.Number),
		IsComplaint: complaint,
		ClusterKey:  cluster,
		CreatedAt:   at,
		Priority:    "normal",
	}
	if productID == "" && len(o.Items) > 0 {
		t.ProductID = o.Items[0].ProductID
	}
	if complaint && g.chance(0.11) || cluster != "" && g.chance(0.2) {
		t.Escalated = true
	}
	if t.Escalated || o.Total > 170 {
		t.Priority = "high"
	}
	if category == "Product enquiry" {
		t.Priority = "low"
	}
	// Response & resolution times (minutes), WhatsApp/chat are faster.
	resp := math.Exp(g.normal(3.6, 0.9)) // median ~36 min
	if ch == "Email" {
		resp *= 2.6
	}
	if cluster != "" && g.now.Sub(at).Hours() < 24*6 {
		resp *= 2.2 // recent surge strains the team
	}
	fr := at.Add(time.Duration(resp) * time.Minute)
	if fr.Before(g.now) {
		t.FirstResponseAt = &fr
	}
	res := math.Exp(g.normal(7.2, 0.8)) // median ~22h
	if t.Escalated {
		res *= 1.8
	}
	rs := at.Add(time.Duration(res) * time.Minute)
	switch {
	case rs.Before(g.now):
		t.ResolvedAt = &rs
		t.Status = "resolved"
	case t.FirstResponseAt != nil:
		t.Status = "pending"
	default:
		t.Status = "open"
	}
	g.ds.Tickets = append(g.ds.Tickets, t)
}

// ---------------------------------------------------------------- inventory

func (g *gen) inventory() {
	n := len(g.ds.Products)
	stock := make([][]int, n)
	restock := make([][]int, n)
	warehouses := []string{"Bhiwandi FC", "Bengaluru FC", "Gurugram FC"}
	stockoutIdx := -1
	for i := 0; i < n; i++ {
		v := 0.0
		for d := Days - 28; d < Days; d++ {
			v += float64(g.soldByDay[i][d])
		}
		v /= 28
		var cover float64
		switch x := g.r.Float64(); {
		case i == g.idxY:
			cover = 4.6
		case i == g.idxX:
			cover = 41
		case v < 0.08:
			cover = 0 // handled below as dead stock
		case x < 0.55:
			cover = g.uniform(26, 70)
		case x < 0.7:
			cover = g.uniform(13, 25)
		case x < 0.8:
			cover = g.uniform(6, 12)
		default:
			cover = g.uniform(110, 220)
		}
		onHand := int(math.Round(v * cover))
		if v < 0.08 {
			onHand = 180 + g.r.Intn(420) // dead stock
		}
		if stockoutIdx == -1 && cover > 6 && cover < 12 && v > 0.6 && i != g.idxPA {
			stockoutIdx = i
			onHand = 0
		}
		lead := 7 + g.r.Intn(15)
		rop := int(math.Ceil(v * float64(lead+7)))
		reserved := 0
		g.ds.Inventory = append(g.ds.Inventory, model.InventoryItem{
			ProductID: g.ds.Products[i].ID, Warehouse: warehouses[i%len(warehouses)],
			OnHand: onHand, Reserved: reserved, ReorderPoint: rop, LeadTimeDays: lead, UpdatedAt: g.now,
		})

		// Reconstruct daily history backwards with a sawtooth restock pattern.
		stock[i] = make([]int, Days)
		restock[i] = make([]int, Days)
		cur := onHand
		cap := max(onHand, rop) + int(float64(rop)*1.6) + 5
		for d := Days - 1; d >= 0; d-- {
			stock[i][d] = cur
			prev := cur + g.soldByDay[i][d]
			if prev > cap && d > 0 {
				target := int(float64(rop) * g.uniform(0.35, 0.9))
				r := prev - target
				if r > 0 {
					restock[i][d] = r
					prev = target
				}
			}
			cur = prev
		}
	}
	// Reserved units = units in orders not yet shipped.
	for _, o := range g.ds.Orders {
		if o.Status == model.OrderProcessing {
			for _, it := range o.Items {
				g.ds.Inventory[g.productIndex(it.ProductID)].Reserved += it.Qty
			}
		}
	}
	for d := 0; d < Days; d++ {
		snap := model.InventorySnapshot{Date: g.day(d)}
		for i := 0; i < n; i++ {
			c := g.ds.Products[i].Cost
			snap.Units += stock[i][d]
			snap.Value += float64(stock[i][d]) * c
			snap.Restocked += float64(restock[i][d]) * c
			if stock[i][d] == 0 {
				snap.Stockouts++
			} else if stock[i][d] <= g.ds.Inventory[i].ReorderPoint/2 {
				snap.LowStock++
			}
		}
		snap.Value = round2(snap.Value)
		snap.Restocked = round2(snap.Restocked)
		g.ds.InvHistory = append(g.ds.InvHistory, snap)
	}
}

// ---------------------------------------------------------------- marketing

var channelCTR = map[string]float64{"google": 0.048, "meta": 0.012, "instagram": 0.009, "email": 0.031, "whatsapp": 0.072}
var channelCPM = map[string]float64{"google": 7, "meta": 4.8, "instagram": 5.3, "email": 0.13, "whatsapp": 1}
var channelConv = map[string]float64{"google": 0.041, "meta": 0.021, "instagram": 0.017, "email": 0.052, "whatsapp": 0.064, "organic": 0.034, "direct": 0.046}

func (g *gen) marketingMetrics() {
	// Revenue attributed per campaign per day.
	rev := make([][]float64, len(g.ds.Campaigns))
	for i := range rev {
		rev[i] = make([]float64, Days)
	}
	type ck struct {
		d  int
		ch string
	}
	ordersByChannel := map[ck]int{}
	campIdx := map[string]int{}
	for i, c := range g.ds.Campaigns {
		campIdx[c.ID] = i
	}
	for _, o := range g.ds.Orders {
		d := g.dayIndex(o.CreatedAt)
		ordersByChannel[ck{d, o.Channel}]++
		if o.CampaignID != "" {
			rev[campIdx[o.CampaignID]][d] += o.Total
		}
	}
	for ci, c := range g.ds.Campaigns {
		baseline := 0.0
		for d := 0; d < Days; d++ {
			expected := rev[ci][d]
			if d >= 7 {
				// smooth spend so it isn't a perfect mirror of revenue
				s := 0.0
				for k := d - 6; k <= d; k++ {
					s += rev[ci][k]
				}
				expected = 0.5*rev[ci][d] + 0.5*s/7
			}
			spend := expected / g.campaignROAS[ci] * g.uniform(0.85, 1.15)
			if ci == festiveCampaign {
				if d == Days-15 {
					baseline = 0
					for k := Days - 21; k < Days-14; k++ {
						baseline += rev[ci][k] / g.campaignROAS[ci]
					}
					baseline /= 7
				}
				if d >= Days-7 {
					spend = baseline * g.uniform(1.3, 1.45)
				}
			}
			if d == Days-1 {
				spend *= g.now.Sub(g.day(d)).Hours() / 24
			}
			ctr := channelCTR[c.Channel] * g.uniform(0.85, 1.15)
			if ci == festiveCampaign && d >= Days-7 {
				ctr *= 0.55 // creative fatigue
			}
			impressions := int(spend / channelCPM[c.Channel] * 1000)
			clicks := int(float64(impressions) * ctr)
			g.ds.CampMetrics = append(g.ds.CampMetrics, model.CampaignMetric{CampaignID: c.ID, Date: g.day(d), Spend: round2(spend), Impressions: impressions, Clicks: clicks})
			if d == Days-1 {
				g.ds.Campaigns[ci].DailyBudget = math.Round(spend*1.2/10) * 10
			}
		}
	}
	channels := []string{"google", "meta", "instagram", "email", "whatsapp", "organic", "direct"}
	for d := 0; d < Days; d++ {
		for _, ch := range channels {
			orders := ordersByChannel[ck{d, ch}]
			conv := channelConv[ch] * g.uniform(0.9, 1.1)
			sessions := int(float64(orders) / conv)
			if sessions < orders {
				sessions = orders
			}
			atc := int(float64(sessions) * g.uniform(0.095, 0.115))
			chk := int(float64(atc) * g.uniform(0.5, 0.58))
			if chk < orders {
				chk = orders + orders/3
			}
			if atc < chk {
				atc = chk + chk/2
			}
			g.ds.Traffic = append(g.ds.Traffic, model.TrafficDaily{
				Date: g.day(d), Channel: ch, Sessions: sessions,
				ProductView: int(float64(sessions) * g.uniform(0.58, 0.66)), AddToCart: atc, Checkout: chk,
			})
		}
	}
}

// ---------------------------------------------------------------- competitors

var competitorNames = map[string][]string{
	"fashion":     {"Threadly", "UrbanWeave", "Modista", "KraftLane"},
	"electronics": {"Gadgetry", "Ampere One", "BoltBox", "Sonix"},
	"beauty":      {"Glowly", "Veda Skin", "Purelle", "Aurum Beauty"},
	"home":        {"Nestery", "Casa Craft", "Urban Hearth", "Dwellio"},
	"grocery":     {"FreshKart", "Annapurna Organics", "GreenCrate", "Desi Pantry"},
}

func (g *gen) competitors() {
	names, ok := competitorNames[g.cg.BusinessType]
	if !ok {
		names = competitorNames["fashion"]
	}
	for i, n := range names {
		g.ds.Competitors = append(g.ds.Competitors, model.Competitor{
			ID: fmt.Sprintf("CP-%d", i+1), Name: n,
			Domain: strings.ToLower(strings.ReplaceAll(n, " ", "")) + ".example",
			Rating: round2(g.uniform(3.8, 4.3)),
		})
	}
	// Track the top sellers plus the anchors.
	type ps struct {
		i int
		u int
	}
	var list []ps
	for i := range g.ds.Products {
		u := 0
		for d := Days - 60; d < Days; d++ {
			u += g.soldByDay[i][d]
		}
		list = append(list, ps{i, u})
	}
	sort.Slice(list, func(a, b int) bool { return list[a].u > list[b].u })
	tracked := map[int]bool{g.idxX: true, g.idxY: true, g.idxPA: true}
	for _, p := range list {
		if len(tracked) >= 16 {
			break
		}
		tracked[p.i] = true
	}
	ids := make([]int, 0, len(tracked))
	for i := range tracked {
		ids = append(ids, i)
	}
	sort.Ints(ids)
	const histDays = 90
	for _, pi := range ids {
		p := g.ds.Products[pi]
		for ci, c := range g.ds.Competitors {
			if pi != g.idxPA && !g.chance(0.72) {
				continue
			}
			base := roundPrice(p.Price * g.uniform(0.88, 1.12))
			rating := round2(math.Min(4.8, c.Rating+g.uniform(-0.3, 0.3)))
			if pi == g.idxPA && ci == 0 {
				base = roundPrice(p.Price * 0.99)
			}
			title := strings.Replace(p.Name, strings.Fields(p.Name)[0], c.Name, 1)
			promoLeft, promoDepth := 0, 0.0
			for d := Days - histDays; d < Days; d++ {
				price := base
				if promoLeft == 0 && g.chance(0.035) {
					promoLeft = 3 + g.r.Intn(5)
					promoDepth = g.uniform(0.08, 0.2)
				}
				if promoLeft > 0 {
					price = roundPrice(base * (1 - promoDepth))
					promoLeft--
				}
				list := base
				if pi == g.idxPA && ci == 0 {
					price = base
					if d >= Days-4 {
						// Permanent price reset (not a promotion): list price moves too.
						price = roundPrice(base * 0.88)
						list = price
					}
				}
				g.ds.CompPrices = append(g.ds.CompPrices, model.CompetitorPrice{
					CompetitorID: c.ID, ProductID: p.ID, Title: title, Price: price, ListPrice: list,
					Rating: rating, InStock: !g.chance(0.04), CapturedAt: g.day(d).Add(6 * time.Hour),
				})
			}
		}
	}
}

// ---------------------------------------------------------------- finance

func (g *gen) finance() {
	for d := 0; d < Days; d++ {
		frac := float64(d) / float64(Days-1)
		opex := (1200 + 235*frac) * g.uniform(0.95, 1.05)
		if g.day(d).Day() == 1 {
			opex += 4800 // monthly rent & payroll true-up
		}
		failRate := g.uniform(0.05, 0.075)
		if d >= Days-3 {
			failRate = g.uniform(0.11, 0.13) // payment gateway degradation
		}
		attempts := float64(g.prepaidDay[d]) / (1 - failRate)
		fails := int(math.Round(attempts * failRate))
		if d == Days-1 {
			opex *= g.now.Sub(g.day(d)).Hours() / 24
		}
		g.ds.Finance = append(g.ds.Finance, model.FinancialDaily{
			Date: g.day(d), Opex: round2(opex), PaymentFailures: fails, FailedAmount: round2(float64(fails) * g.uniform(50, 70)),
		})
	}
}

// ---------------------------------------------------------------- news

func (g *gen) news() {
	compA := g.ds.Competitors[0].Name
	compB := g.ds.Competitors[1].Name
	x := g.ds.Products[g.idxX]
	pa := g.ds.Products[g.idxPA]
	topCat := x.Category
	type art struct {
		days                                                       float64
		title, source, category, impact, summary, why, rec, entity string
		rel                                                        int
	}
	arts := []art{
		{0.3, fmt.Sprintf("%s launches a new %s line at aggressive introductory prices", compA, strings.ToLower(topCat)), "D2C Weekly", "Competitor", "high",
			fmt.Sprintf("%s has expanded into %s with 40+ SKUs priced 8–15%% below category averages, backed by a creator-led launch campaign.", compA, strings.ToLower(topCat)),
			fmt.Sprintf("The launch directly overlaps with %s, your highest-revenue category, and arrives while %s is already seeing elevated returns.", topCat, x.Name),
			"Monitor price response and conversion on overlapping SKUs for the next 14 days; protect hero products with bundles rather than blanket discounts.", compA, 94},
		{1.2, fmt.Sprintf("%s cuts prices across its %s range ahead of the season", compA, strings.ToLower(pa.Category)), "Retail Pulse", "Competitor", "high",
			fmt.Sprintf("%s reduced prices on several %s best-sellers by 10–12%%, including direct substitutes for products in your catalog.", compA, strings.ToLower(pa.Category)),
			fmt.Sprintf("Your %s is now priced above %s's equivalent, and its daily unit sales have softened since the change.", pa.Name, compA),
			"Review the Pricing agent's recommendation for this SKU before matching — your rating advantage may justify a smaller gap.", compA, 90},
		{2.5, "Festive-season online shopping expected to grow 18–22% year on year", "The Commerce Ledger", "Market trend", "medium",
			"Industry analysts expect strong festive demand led by tier-2 and tier-3 cities, with mobile commerce accounting for over 80% of orders.",
			"Tier-2 cities already account for a growing share of your orders; the peak will stress inventory on fast movers.",
			"Bring forward replenishment for the top 20 SKUs and confirm courier capacity for the peak window.", "", 82},
		{3.4, "Logistics networks warn of capacity crunch in eastern states", "Supply Chain Today", "Logistics", "high",
			"Several last-mile carriers report hub congestion and staffing shortages across West Bengal, Odisha and Bihar, with transit times stretching by 2–4 days.",
			"Your Swiftline shipments to the East are already running late, and delivery-delay complaints from the region are rising.",
			"Shift East-bound volume to the best-performing courier until transit times normalise.", "Swiftline", 88},
		{4.1, "Draft consumer-protection guidance targets misleading sale countdowns and drip pricing", "Policy Brief India", "Regulation", "medium",
			"A draft advisory proposes clearer disclosure of total price (including shipping and COD fees) at the start of checkout and restrictions on fake urgency timers.",
			"Your checkout adds shipping fees at the final step for orders under $35 and uses countdown banners during sales.",
			"Audit checkout and sale banners now; showing all-inclusive prices early also tends to reduce COD refusals.", "", 74},
		{5.5, "Shoppers increasingly prefer UPI over cash on delivery, survey finds", "Fintech Times", "Consumer", "medium",
			"A consumer survey finds prepaid adoption rising across age groups when brands offer small prepaid incentives and fast refunds.",
			"COD orders carry most of your RTO losses; nudging prepaid could lift margins directly.",
			"Test a $2 prepaid incentive on COD-heavy regions and measure RTO change.", "", 79},
		{6.8, fmt.Sprintf("%s raises funding to expand quick delivery in metro cities", compB), "Startup Wire", "Competitor", "medium",
			fmt.Sprintf("%s announced fresh funding to build dark stores enabling same-day delivery in six metros.", compB),
			"Faster delivery expectations in metros may raise the bar for your 2–4 day delivery promise.",
			"Track delivery-speed mentions in reviews and consider express shipping for metro pin codes.", compB, 70},
		{8.2, "Meta ad costs rise as advertisers crowd into festive inventory", "AdTech Daily", "Market trend", "medium",
			"Average CPMs on Meta platforms have risen double digits month on month as brands front-load festive campaigns.",
			"Your Festive Prospecting campaign's efficiency has dropped sharply this week while spend increased.",
			"Cap broad prospecting budgets and shift spend to retargeting and owned channels (email, WhatsApp).", "", 81},
		{10.5, "Sustainability claims face scrutiny in D2C marketing", "Brand Equity Review", "Regulation", "low",
			"Regulators and consumer groups are scrutinising vague 'eco-friendly' claims in product listings and ads.",
			"Several of your listings use sustainability language without certification details.",
			"Add verifiable material details or certifications to listings that make sustainability claims.", "", 58},
		{12.0, "Return-fraud and wardrobing rise during sale periods, retailers report", "Retail Pulse", "Market trend", "medium",
			"Retailers report higher return rates in the weeks after major sales, with sizing and 'changed mind' as the most cited reasons.",
			fmt.Sprintf("Your return rate is elevated on %s, but its pattern (sizing + quality) suggests a product issue rather than wardrobing.", x.Name),
			"Separate product-driven return reasons from behavioural ones before tightening return policies.", "", 72},
		{14.5, "WhatsApp commerce adoption accelerates among D2C brands", "D2C Weekly", "Technology", "low",
			"More brands are running catalog, checkout and support on WhatsApp, reporting higher repeat-purchase rates.",
			"WhatsApp already delivers one of your highest ROAS channels.",
			"Expand WhatsApp win-back flows to customers predicted to repurchase in the next 30 days.", "", 66},
		{17.0, "Cotton and linen yarn prices ease after strong harvest", "Textile Insights", "Supply", "low",
			"Raw-material prices for cotton and linen have eased 6–9% over the quarter.",
			"Lower input costs create room to protect margin while responding to competitor price moves.",
			"Renegotiate supplier contracts for the next production run.", "", 61},
		{20.0, "Generative AI search changes how shoppers discover products", "AdTech Daily", "Technology", "low",
			"AI-assisted search experiences are reducing clicks on traditional search ads for generic category queries.",
			"Your non-brand search campaign may see rising costs per acquisition over the coming months.",
			"Invest in structured product data and reviews, which AI search surfaces favour.", "", 55},
		{23.0, "Courier networks add capacity in southern hubs", "Supply Chain Today", "Logistics", "low",
			"Two national carriers announced new sorting hubs near Bengaluru and Hyderabad, promising faster transit to South India.",
			"South India is one of your largest regions; faster transit could lift conversion there.",
			"Re-test delivery promises for southern pin codes once the hubs go live.", "", 52},
		{26.0, "Influencer marketing spend shifts to micro-creators", "Brand Equity Review", "Market trend", "low",
			"Brands are reallocating influencer budgets from celebrities to micro-creators with higher engagement rates.",
			"Your Reels creator campaign is mid-funnel; micro-creator content could improve its ROAS.",
			"Pilot 5 micro-creators with trackable codes against the current creator mix.", "", 57},
	}
	for i, a := range arts {
		g.ds.News = append(g.ds.News, model.NewsArticle{
			ID: fmt.Sprintf("NW-%d", 100+i), Title: a.title, Source: a.source,
			URL: "#", PublishedAt: g.now.Add(-time.Duration(a.days*24) * time.Hour),
			Category: a.category, Relevance: a.rel, Impact: a.impact, Summary: a.summary,
			WhyItMatters: a.why, Recommendation: a.rec, RelatedEntity: a.entity,
		})
	}
}
