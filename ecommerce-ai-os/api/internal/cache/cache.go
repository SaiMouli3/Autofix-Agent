// Package cache provides response caching and rate-limit counters, backed by
// Redis when REDIS_URL is configured and by process memory otherwise.
package cache

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type Cache interface {
	Get(ctx context.Context, key string) ([]byte, bool)
	Set(ctx context.Context, key string, val []byte, ttl time.Duration)
	// Incr increments a counter that expires ttl after its first increment.
	Incr(ctx context.Context, key string, ttl time.Duration) (int64, error)
	DeletePrefix(ctx context.Context, prefix string)
	Kind() string
	Close()
}

// ---------------------------------------------------------------- memory

type entry struct {
	val []byte
	n   int64
	exp time.Time
}

type Memory struct {
	mu sync.Mutex
	m  map[string]*entry
}

func NewMemory() *Memory {
	c := &Memory{m: map[string]*entry{}}
	go func() {
		for range time.Tick(time.Minute) {
			c.mu.Lock()
			now := time.Now()
			for k, e := range c.m {
				if now.After(e.exp) {
					delete(c.m, k)
				}
			}
			c.mu.Unlock()
		}
	}()
	return c
}

func (c *Memory) Kind() string { return "memory" }
func (c *Memory) Close()       {}

func (c *Memory) Get(_ context.Context, key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || time.Now().After(e.exp) {
		return nil, false
	}
	return e.val, true
}

func (c *Memory) Set(_ context.Context, key string, val []byte, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[key] = &entry{val: val, exp: time.Now().Add(ttl)}
}

func (c *Memory) Incr(_ context.Context, key string, ttl time.Duration) (int64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || time.Now().After(e.exp) {
		e = &entry{exp: time.Now().Add(ttl)}
		c.m[key] = e
	}
	e.n++
	return e.n, nil
}

func (c *Memory) DeletePrefix(_ context.Context, prefix string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for k := range c.m {
		if strings.HasPrefix(k, prefix) {
			delete(c.m, k)
		}
	}
}

// ---------------------------------------------------------------- redis

type Redis struct{ c *redis.Client }

func NewRedis(ctx context.Context, url string) (*Redis, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	c := redis.NewClient(opt)
	if err := c.Ping(ctx).Err(); err != nil {
		return nil, err
	}
	return &Redis{c: c}, nil
}

func (r *Redis) Kind() string { return "redis" }
func (r *Redis) Close()       { r.c.Close() }

func (r *Redis) Get(ctx context.Context, key string) ([]byte, bool) {
	b, err := r.c.Get(ctx, "eaos:"+key).Bytes()
	return b, err == nil
}

func (r *Redis) Set(ctx context.Context, key string, val []byte, ttl time.Duration) {
	r.c.Set(ctx, "eaos:"+key, val, ttl)
}

func (r *Redis) Incr(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	k := "eaos:rl:" + key
	pipe := r.c.TxPipeline()
	incr := pipe.Incr(ctx, k)
	pipe.ExpireNX(ctx, k, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return incr.Val(), nil
}

func (r *Redis) DeletePrefix(ctx context.Context, prefix string) {
	iter := r.c.Scan(ctx, 0, "eaos:"+prefix+"*", 200).Iterator()
	for iter.Next(ctx) {
		r.c.Del(ctx, iter.Val())
	}
}
