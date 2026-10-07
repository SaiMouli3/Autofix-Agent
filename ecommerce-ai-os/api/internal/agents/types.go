// Package agents implements the AI operating team. Each agent owns exactly
// one business domain and follows the same pipeline:
//
//	data sources → metrics (deterministic) → rules + anomaly detection
//	→ insights + recommendations → activity
//
// Numbers are always computed here; the LLM layer only explains, summarises
// and converses on top of these structured results.
package agents

import (
	"fmt"
	"hash/fnv"
	"math"
	"strings"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/analytics"
	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

type H = map[string]any

const (
	SevCritical    = "critical"
	SevImportant   = "important"
	SevOpportunity = "opportunity"
	SevMarket      = "market"
	SevInfo        = "info"
)

var severityRank = map[string]int{SevCritical: 0, SevImportant: 1, SevOpportunity: 2, SevMarket: 3, SevInfo: 4}

type KPI struct {
	Key       string    `json:"key"`
	Label     string    `json:"label"`
	Value     float64   `json:"value"`
	Prev      float64   `json:"prev"`
	Change    float64   `json:"change"`
	Unit      string    `json:"unit"`      // currency | number | percent | hours | rating | ratio | days
	Direction string    `json:"direction"` // up | down: which direction is good
	Spark     []float64 `json:"spark,omitempty"`
	Hint      string    `json:"hint,omitempty"`
	Href      string    `json:"href,omitempty"`
}

func NewKPI(key, label string, cur, prev float64, unit, dir string) KPI {
	ch := analytics.Pct(cur, prev)
	if unit == "percent" || unit == "rating" {
		ch = cur - prev // percentage points / rating points
	}
	return KPI{Key: key, Label: label, Value: analytics.Round(cur, 4), Prev: analytics.Round(prev, 4), Change: analytics.Round(ch, 2), Unit: unit, Direction: dir}
}

type Evidence struct {
	Label  string   `json:"label"`
	Value  string   `json:"value"`
	Change *float64 `json:"change,omitempty"`
	Unit   string   `json:"unit,omitempty"` // "pct" | "pts"
	Tone   string   `json:"tone,omitempty"` // bad | good | neutral
}

func Ev(label, value string) Evidence { return Evidence{Label: label, Value: value} }
func EvC(label, value string, change float64, unit, tone string) Evidence {
	c := analytics.Round(change, 1)
	return Evidence{Label: label, Value: value, Change: &c, Unit: unit, Tone: tone}
}

type Action struct {
	Label  string `json:"label"`
	Intent string `json:"intent"` // investigate | view | assign | dismiss | apply | generate
	Href   string `json:"href,omitempty"`
}

type EntityRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Insight struct {
	ID             string     `json:"id"`
	AgentID        string     `json:"agentId"`
	Severity       string     `json:"severity"`
	Title          string     `json:"title"`
	Summary        string     `json:"summary"`
	Evidence       []Evidence `json:"evidence"`
	LikelyCause    string     `json:"likelyCause,omitempty"`
	Impact         string     `json:"impact,omitempty"`
	ImpactValue    float64    `json:"impactValue"` // USD per month, signed (negative = loss)
	Recommendation string     `json:"recommendation"`
	Actions        []Action   `json:"actions"`
	Entity         *EntityRef `json:"entity,omitempty"`
	DetectedAt     time.Time  `json:"detectedAt"`
	Confidence     float64    `json:"confidence"`
	Sources        []string   `json:"sources,omitempty"` // contributing agents (business insights)
	Status         string     `json:"status"`            // new | assigned | dismissed | resolved
	Assignee       string     `json:"assignee,omitempty"`
}

type Activity struct {
	ID        string    `json:"id"`
	AgentID   string    `json:"agentId"`
	At        time.Time `json:"at"`
	Kind      string    `json:"kind"` // detection | scan | recommendation | sync
	Message   string    `json:"message"`
	Severity  string    `json:"severity,omitempty"`
	InsightID string    `json:"insightId,omitempty"`
}

type Change struct {
	Label     string  `json:"label"`
	Cur       float64 `json:"cur"`
	Prev      float64 `json:"prev"`
	Change    float64 `json:"change"`
	Unit      string  `json:"unit"`
	Direction string  `json:"direction"`
	Note      string  `json:"note,omitempty"`
}

func ChangeFromKPI(k KPI) Change {
	return Change{Label: k.Label, Cur: k.Value, Prev: k.Prev, Change: k.Change, Unit: k.Unit, Direction: k.Direction}
}

type Meta struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	ShortName        string   `json:"shortName"`
	Question         string   `json:"question"`
	Description      string   `json:"description"`
	Icon             string   `json:"icon"`
	DataSources      []string `json:"dataSources"`
	Responsibilities []string `json:"responsibilities"`
}

type Headline struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
	Unit  string  `json:"unit"`
}

type Summary struct {
	Meta
	Status          string    `json:"status"` // monitoring | analyzing | attention | connection_issue | paused
	Health          float64   `json:"health"`
	HealthPrev      float64   `json:"healthPrev"`
	HealthLabel     string    `json:"healthLabel"`
	LastAnalysis    time.Time `json:"lastAnalysis"`
	Issues          int       `json:"issues"`
	Opportunities   int       `json:"opportunities"`
	Recommendations int       `json:"recommendations"`
	Headline        Headline  `json:"headline"`
	RecordsAnalyzed int       `json:"recordsAnalyzed"`
}

type Result struct {
	Summary  Summary    `json:"summary"`
	Insights []Insight  `json:"insights"`
	Activity []Activity `json:"activity"`
	Changes  []Change   `json:"changes"`
	View     H          `json:"view"`
}

// Ctx carries the dataset and windows for one analysis run.
type Ctx struct {
	DS  *model.Dataset
	R   analytics.Range
	Now time.Time
}

// ---------------------------------------------------------------- helpers

func stableID(parts ...string) string {
	h := fnv.New32a()
	h.Write([]byte(strings.Join(parts, "|")))
	return fmt.Sprintf("in_%08x", h.Sum32())
}

func hashN(s string, n int) int {
	h := fnv.New32a()
	h.Write([]byte(s))
	return int(h.Sum32() % uint32(n))
}

// detectedAt produces a stable "detected today" timestamp for an insight.
func detectedAt(now time.Time, id string, maxMinutes int) time.Time {
	return now.Add(-time.Duration(4+hashN(id, maxMinutes)) * time.Minute)
}

// USD formats dollars in short notation: $48.2K, $1.24M, $1.06B.
func USD(v float64) string {
	sign := ""
	if v < 0 {
		sign = "-"
		v = -v
	}
	switch {
	case v >= 1e9:
		return fmt.Sprintf("%s$%.2fB", sign, v/1e9)
	case v >= 1e6:
		return fmt.Sprintf("%s$%.2fM", sign, v/1e6)
	case v >= 1e3:
		return fmt.Sprintf("%s$%.1fK", sign, v/1e3)
	case v >= 100 || v == math.Trunc(v):
		return sign + "$" + Num(v)
	default:
		return fmt.Sprintf("%s$%.2f", sign, v)
	}
}

// USDFull formats dollars with US thousands separators: $12,345.
func USDFull(v float64) string {
	if v < 0 {
		return "-$" + Num(-v)
	}
	return "$" + Num(v)
}

func Pct1(v float64) string { return fmt.Sprintf("%.1f%%", v) }
func Num(v float64) string {
	if v >= 1000 {
		s := fmt.Sprintf("%.0f", v)
		out := ""
		for i, c := range s {
			if i > 0 && (len(s)-i)%3 == 0 {
				out += ","
			}
			out += string(c)
		}
		return out
	}
	return fmt.Sprintf("%.0f", v)
}
func Signed(v float64) string {
	if v >= 0 {
		return fmt.Sprintf("+%.0f%%", v)
	}
	return fmt.Sprintf("%.0f%%", v)
}

func healthLabel(h float64) string {
	switch {
	case h >= 85:
		return "Excellent"
	case h >= 72:
		return "Healthy"
	case h >= 58:
		return "Needs attention"
	default:
		return "At risk"
	}
}

// orderCounted reports whether an order counts toward sales.
func orderCounted(o *model.Order) bool { return o.Status != model.OrderCancelled }

func orderCOGS(o *model.Order) float64 {
	c := 0.0
	for _, it := range o.Items {
		c += it.UnitCost * float64(it.Qty)
	}
	return c
}

// series builds a bucketed time series for the range.
type seriesBuilder struct {
	r       analytics.Range
	buckets []time.Time
	vals    map[string][]float64
	keys    []string
}

func newSeries(r analytics.Range, keys ...string) *seriesBuilder {
	b := &seriesBuilder{r: r, buckets: trendBuckets(r), vals: map[string][]float64{}, keys: keys}
	for _, k := range keys {
		b.vals[k] = make([]float64, len(b.buckets))
	}
	return b
}

// trendBuckets returns chart buckets for the range without a trailing
// partial day/week, so trend lines don't show a false collapse at the end.
func trendBuckets(r analytics.Range) []time.Time {
	buckets := r.Buckets()
	// Drop a trailing partial day/week so trend lines don't show a false
	// collapse at the end; totals still include it.
	if r.Granularity != "hour" && len(buckets) > 2 {
		step := 24 * time.Hour
		if r.Granularity == "week" {
			step = 7 * 24 * time.Hour
		}
		if last := buckets[len(buckets)-1]; last.Add(step).After(r.To) {
			buckets = buckets[:len(buckets)-1]
		}
	}
	return buckets
}

func (s *seriesBuilder) add(key string, t time.Time, v float64) {
	i := s.r.Bucket(t)
	if i < 0 || i >= len(s.buckets) {
		return
	}
	s.vals[key][i] += v
}

func (s *seriesBuilder) get(key string) []float64 { return s.vals[key] }

func (s *seriesBuilder) set(key string, vals []float64) {
	if _, ok := s.vals[key]; !ok {
		s.keys = append(s.keys, key)
	}
	s.vals[key] = vals
}

func (s *seriesBuilder) rows() []H {
	out := make([]H, len(s.buckets))
	for i, t := range s.buckets {
		row := H{"t": s.r.Label_(t)}
		for _, k := range s.keys {
			row[k] = analytics.Round(s.vals[k][i], 3)
		}
		out[i] = row
	}
	return out
}

func ratioSeries(a, b []float64, mult float64) []float64 {
	out := make([]float64, len(a))
	for i := range a {
		if b[i] > 0 {
			out[i] = a[i] / b[i] * mult
		}
	}
	return out
}

// prevAligned shifts a timestamp from the previous period into the current
// period for overlay comparisons.
func (c *Ctx) shiftPrev(t time.Time) time.Time { return t.Add(c.R.From.Sub(c.R.PrevFrom)) }

func sortInsights(in []Insight) {
	for i := 1; i < len(in); i++ {
		for j := i; j > 0; j-- {
			a, b := in[j-1], in[j]
			if severityRank[a.Severity] > severityRank[b.Severity] ||
				(severityRank[a.Severity] == severityRank[b.Severity] && math.Abs(a.ImpactValue) < math.Abs(b.ImpactValue)) {
				in[j-1], in[j] = in[j], in[j-1]
			} else {
				break
			}
		}
	}
}

func countSev(ins []Insight) (issues, opps, recs int) {
	for _, i := range ins {
		switch i.Severity {
		case SevCritical, SevImportant:
			issues++
		case SevOpportunity:
			opps++
		}
		if i.Recommendation != "" {
			recs++
		}
	}
	return
}

func summarize(meta Meta, now time.Time, health, healthPrev float64, ins []Insight, headline Headline, records int) Summary {
	issues, opps, recs := countSev(ins)
	status := "monitoring"
	for _, i := range ins {
		if i.Severity == SevCritical {
			status = "attention"
		}
	}
	return Summary{
		Meta: meta, Status: status, Health: math.Round(health), HealthPrev: math.Round(healthPrev),
		HealthLabel: healthLabel(health), LastAnalysis: now.Add(-time.Duration(1+hashN(meta.ID, 4)) * time.Minute),
		Issues: issues, Opportunities: opps, Recommendations: recs, Headline: headline, RecordsAnalyzed: records,
	}
}

func f64p(v float64) *float64 { return &v }
