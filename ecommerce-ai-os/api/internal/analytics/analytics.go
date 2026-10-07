// Package analytics holds deterministic, LLM-free numeric helpers: date
// ranges, bucketing, period comparisons and simple statistics. Every metric
// in the product is calculated here or in the agents, never by an LLM.
package analytics

import (
	"math"
	"sort"
	"time"
)

var IST = time.FixedZone("IST", 5*3600+1800)

func StartOfDay(t time.Time) time.Time {
	t = t.In(IST)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, IST)
}

// Range is a half-open [From, To) analysis window with its comparison period.
type Range struct {
	Key         string    `json:"key"`
	Label       string    `json:"label"`
	From        time.Time `json:"from"`
	To          time.Time `json:"to"`
	PrevFrom    time.Time `json:"prevFrom"`
	PrevTo      time.Time `json:"prevTo"`
	Granularity string    `json:"granularity"` // hour | day | week
}

func ParseRange(key, from, to string, now time.Time) Range {
	sod := StartOfDay(now)
	r := Range{Key: key, Granularity: "day"}
	switch key {
	case "today":
		r.Label, r.From, r.To, r.Granularity = "Today", sod, now, "hour"
		r.PrevFrom, r.PrevTo = sod.AddDate(0, 0, -1), now.AddDate(0, 0, -1)
		return r
	case "yesterday":
		r.Label, r.From, r.To, r.Granularity = "Yesterday", sod.AddDate(0, 0, -1), sod, "hour"
		r.PrevFrom, r.PrevTo = sod.AddDate(0, 0, -2), sod.AddDate(0, 0, -1)
		return r
	case "7d":
		r.Label, r.From = "Last 7 days", sod.AddDate(0, 0, -6)
	case "90d":
		r.Label, r.From = "Last 90 days", sod.AddDate(0, 0, -89)
		r.Granularity = "week"
	case "custom":
		f, err1 := time.ParseInLocation("2006-01-02", from, IST)
		t, err2 := time.ParseInLocation("2006-01-02", to, IST)
		if err1 == nil && err2 == nil && !t.Before(f) {
			r.Label = f.Format("2 Jan") + " – " + t.Format("2 Jan")
			r.From, r.To = f, t.AddDate(0, 0, 1)
			if r.To.After(now) {
				r.To = now
			}
			span := r.To.Sub(r.From)
			r.PrevFrom, r.PrevTo = r.From.Add(-span), r.From
			if span > 62*24*time.Hour {
				r.Granularity = "week"
			}
			return r
		}
		fallthrough
	default:
		r.Key, r.Label, r.From = "30d", "Last 30 days", sod.AddDate(0, 0, -29)
	}
	r.To = now
	span := r.To.Sub(r.From)
	r.PrevFrom, r.PrevTo = r.From.Add(-span), r.From
	return r
}

func (r Range) Contains(t time.Time) bool     { return !t.Before(r.From) && t.Before(r.To) }
func (r Range) PrevContains(t time.Time) bool { return !t.Before(r.PrevFrom) && t.Before(r.PrevTo) }
func (r Range) Days() float64                 { return math.Max(r.To.Sub(r.From).Hours()/24, 1.0/24) }

// Buckets returns bucket start times and labels covering the range.
func (r Range) Buckets() []time.Time {
	var out []time.Time
	switch r.Granularity {
	case "hour":
		for t := r.From; t.Before(r.To) || len(out) == 0; t = t.Add(time.Hour) {
			out = append(out, t)
			if len(out) >= 24 {
				break
			}
		}
	case "week":
		for t := StartOfDay(r.From); t.Before(r.To); t = t.AddDate(0, 0, 7) {
			out = append(out, t)
		}
	default:
		for t := StartOfDay(r.From); t.Before(r.To); t = t.AddDate(0, 0, 1) {
			out = append(out, t)
		}
	}
	return out
}

// Bucket returns the index of t within Buckets(), or -1.
func (r Range) Bucket(t time.Time) int {
	if !r.Contains(t) {
		return -1
	}
	switch r.Granularity {
	case "hour":
		return int(t.Sub(r.From).Hours())
	case "week":
		return int(t.Sub(StartOfDay(r.From)).Hours() / (24 * 7))
	default:
		return int(StartOfDay(t).Sub(StartOfDay(r.From)).Hours() / 24)
	}
}

func (r Range) Label_(t time.Time) string {
	switch r.Granularity {
	case "hour":
		return t.In(IST).Format("15:04")
	default:
		return t.In(IST).Format("2006-01-02")
	}
}

// Window is a fixed monitoring window anchored on now, used by agents for
// anomaly detection independent of the dashboard range.
type Window struct{ From, To time.Time }

func LastDays(now time.Time, days int) Window {
	return Window{From: now.Add(-time.Duration(days) * 24 * time.Hour), To: now}
}
func (w Window) Before(days int) Window {
	return Window{From: w.From.Add(-time.Duration(days) * 24 * time.Hour), To: w.From}
}
func (w Window) Contains(t time.Time) bool { return !t.Before(w.From) && t.Before(w.To) }
func (w Window) Days() float64             { return w.To.Sub(w.From).Hours() / 24 }

// Pct returns percentage change from prev to cur.
func Pct(cur, prev float64) float64 {
	if prev == 0 {
		if cur == 0 {
			return 0
		}
		return 100
	}
	return (cur - prev) / math.Abs(prev) * 100
}

func Ratio(a, b float64) float64 {
	if b == 0 {
		return 0
	}
	return a / b
}

func Round(v float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.Round(v*p) / p
}

func Clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func Mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := 0.0
	for _, x := range xs {
		s += x
	}
	return s / float64(len(xs))
}

func StdDev(xs []float64) float64 {
	if len(xs) < 2 {
		return 0
	}
	m := Mean(xs)
	s := 0.0
	for _, x := range xs {
		s += (x - m) * (x - m)
	}
	return math.Sqrt(s / float64(len(xs)-1))
}

func Median(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	c := append([]float64(nil), xs...)
	sort.Float64s(c)
	n := len(c)
	if n%2 == 1 {
		return c[n/2]
	}
	return (c[n/2-1] + c[n/2]) / 2
}

func Percentile(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	c := append([]float64(nil), xs...)
	sort.Float64s(c)
	i := p / 100 * float64(len(c)-1)
	lo := int(math.Floor(i))
	hi := int(math.Ceil(i))
	return c[lo] + (c[hi]-c[lo])*(i-float64(lo))
}

// ZScore of the last value against the preceding values.
func ZScore(series []float64) float64 {
	if len(series) < 4 {
		return 0
	}
	base := series[:len(series)-1]
	sd := StdDev(base)
	if sd == 0 {
		return 0
	}
	return (series[len(series)-1] - Mean(base)) / sd
}

// LinearTrend returns slope and intercept of a least-squares fit.
func LinearTrend(ys []float64) (slope, intercept float64) {
	n := float64(len(ys))
	if n < 2 {
		return 0, Mean(ys)
	}
	var sx, sy, sxx, sxy float64
	for i, y := range ys {
		x := float64(i)
		sx += x
		sy += y
		sxx += x * x
		sxy += x * y
	}
	d := n*sxx - sx*sx
	if d == 0 {
		return 0, sy / n
	}
	slope = (n*sxy - sx*sy) / d
	intercept = (sy - slope*sx) / n
	return
}

// Score maps a value onto 0..100 given a "good" and "bad" anchor (either
// direction).
func Score(v, good, bad float64) float64 {
	if good == bad {
		return 50
	}
	return Clamp((v-bad)/(good-bad)*100, 0, 100)
}

// Two-proportion z test, used to decide whether a rate change is significant.
func ProportionZ(x1, n1, x2, n2 float64) float64 {
	if n1 == 0 || n2 == 0 {
		return 0
	}
	p1, p2 := x1/n1, x2/n2
	p := (x1 + x2) / (n1 + n2)
	se := math.Sqrt(p * (1 - p) * (1/n1 + 1/n2))
	if se == 0 {
		return 0
	}
	return (p1 - p2) / se
}
