package agents

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/saimouli3/ecommerce-ai-os/api/internal/model"
)

var MarketMeta = Meta{
	ID: "market", Name: "Market & News Agent", ShortName: "Market & News", Icon: "newspaper",
	Question:    "What is changing outside my business?",
	Description: "Owns external intelligence — industry news, competitor announcements, market and consumer trends, regulation and technology shifts.",
	DataSources: []string{"News feeds", "Industry publications", "Regulatory updates", "Competitor websites"},
	Responsibilities: []string{"Industry news", "Competitor announcements", "Market trends", "Consumer trends",
		"Regulations", "Category changes", "Technology changes", "External events"},
}

const sourcesMonitored = 46

func AnalyzeMarket(c *Ctx) Result {
	ds, now := c.DS, c.Now
	arts := append([]model.NewsArticle(nil), ds.News...)
	sort.Slice(arts, func(i, j int) bool { return arts[i].PublishedAt.After(arts[j].PublishedAt) })
	cats := map[string]int{}
	impact := map[string]int{}
	compMentions := 0
	week := 0
	for _, a := range arts {
		cats[a.Category]++
		impact[a.Impact]++
		if a.Category == "Competitor" {
			compMentions++
		}
		if now.Sub(a.PublishedAt).Hours() < 24*7 {
			week++
		}
	}
	var catRows []H
	for k, v := range cats {
		catRows = append(catRows, H{"category": k, "count": v})
	}
	sort.Slice(catRows, func(i, j int) bool { return catRows[i]["count"].(int) > catRows[j]["count"].(int) })
	var insights []Insight
	for _, a := range arts {
		if now.Sub(a.PublishedAt).Hours() > 24*7 || a.Impact == "low" {
			continue
		}
		sev := SevMarket
		if a.Impact == "high" && a.Category == "Logistics" {
			sev = SevImportant
		}
		id := stableID("market", a.ID)
		insights = append(insights, Insight{
			ID: id, AgentID: "market", Severity: sev, Title: a.Title, Summary: a.Summary,
			Evidence:       []Evidence{Ev("Source", a.Source), Ev("Relevance", fmt.Sprintf("%d/100", a.Relevance)), Ev("Impact", a.Impact)},
			LikelyCause:    a.WhyItMatters,
			Recommendation: a.Recommendation,
			Impact:         a.WhyItMatters,
			Actions:        []Action{{Label: "Read summary", Intent: "view", Href: "/agents/market?article=" + a.ID}},
			DetectedAt:     a.PublishedAt.Add(23 * time.Minute), Confidence: float64(a.Relevance) / 100,
		})
	}
	sortInsights(insights)
	high := impact["high"]
	health := 100 - math.Min(40, float64(high)*9)
	view := H{
		"kpis": []KPI{
			NewKPI("sources", "Sources monitored", sourcesMonitored, sourcesMonitored, "number", "up"),
			NewKPI("relevant", "Relevant articles (30d)", float64(len(arts)), float64(len(arts)), "number", "neutral"),
			NewKPI("high", "High-impact signals", float64(high), float64(high), "number", "down"),
			NewKPI("competitor", "Competitor mentions", float64(compMentions), float64(compMentions), "number", "neutral"),
		},
		"articles": arts, "categories": catRows,
		"impact":          []H{{"impact": "high", "count": impact["high"]}, {"impact": "medium", "count": impact["medium"]}, {"impact": "low", "count": impact["low"]}},
		"healthBreakdown": []H{{"label": "External risk exposure", "score": math.Round(health)}},
	}
	sum := summarize(MarketMeta, now, health, health+3, insights, Headline{Label: "New signals this week", Value: float64(week), Unit: "number"}, sourcesMonitored*31)
	return Result{Summary: sum, Insights: insights, View: view, Activity: scanActivity(c, MarketMeta.ID, "market")}
}
