package seed

// Catalog describes the product universe for one business type. Product
// names are composed as "<Line> <Style> <Item>" and categories carry their
// own price band, cost ratio and baseline return probability.
type category struct {
	Name       string
	Items      []string
	Styles     []string
	Count      int
	PriceMin   float64
	PriceMax   float64
	CostRatio  float64
	ReturnRate float64
	// FitSensitive categories produce sizing-related returns and reviews.
	FitSensitive bool
}

type catalog struct {
	BusinessType string
	StoreName    string
	Lines        []string
	Categories   []category
	Suppliers    []string
	// Anchor roles: index of the category + item used for seeded anomalies.
	QualityIssue  anchor // Product X: returns / complaints / reviews spike
	Stockout      anchor // Product Y: projected stockout
	PriceAttacked anchor // Product targeted by Competitor A price drop
}

type anchor struct {
	Category int
	Name     string
}

var catalogs = map[string]catalog{
	"fashion": {
		BusinessType: "fashion",
		StoreName:    "Loomline",
		Lines:        []string{"Aurora", "Metro", "Coastal", "Nomad", "Saffron", "Indigo", "Monsoon", "Juniper", "Harbor", "Ember", "Willow", "Atlas", "Kora", "Verve"},
		Categories: []category{
			{Name: "Shirts", Items: []string{"Shirt", "Oxford Shirt", "Overshirt"}, Styles: []string{"Linen", "Cotton", "Poplin", "Chambray", "Twill"}, Count: 14, PriceMin: 1299, PriceMax: 2499, CostRatio: 0.38, ReturnRate: 0.07, FitSensitive: true},
			{Name: "T-Shirts", Items: []string{"Tee", "Polo", "Henley"}, Styles: []string{"Supima", "Organic", "Waffle", "Pique", "Slub"}, Count: 14, PriceMin: 599, PriceMax: 1299, CostRatio: 0.34, ReturnRate: 0.05, FitSensitive: true},
			{Name: "Dresses", Items: []string{"Midi Dress", "Wrap Dress", "Shirt Dress"}, Styles: []string{"Floral", "Linen", "Tiered", "Satin", "Block-print"}, Count: 12, PriceMin: 1799, PriceMax: 3499, CostRatio: 0.40, ReturnRate: 0.10, FitSensitive: true},
			{Name: "Denim", Items: []string{"Jeans", "Denim Jacket", "Denim Shorts"}, Styles: []string{"Slim Selvedge", "Relaxed", "Tapered", "Straight", "Raw"}, Count: 12, PriceMin: 1999, PriceMax: 3999, CostRatio: 0.42, ReturnRate: 0.09, FitSensitive: true},
			{Name: "Ethnic", Items: []string{"Kurta", "Kurta Set", "Nehru Jacket"}, Styles: []string{"Handloom", "Chanderi", "Block-print", "Khadi", "Silk-blend"}, Count: 12, PriceMin: 1499, PriceMax: 4499, CostRatio: 0.41, ReturnRate: 0.08, FitSensitive: true},
			{Name: "Footwear", Items: []string{"Sneaker", "Loafer", "Sandal"}, Styles: []string{"Cloudstep Running", "Leather", "Canvas", "Suede", "Knit"}, Count: 12, PriceMin: 1999, PriceMax: 4999, CostRatio: 0.45, ReturnRate: 0.08, FitSensitive: true},
			{Name: "Activewear", Items: []string{"Joggers", "Training Tee", "Track Jacket"}, Styles: []string{"DryFit", "Stretch", "Thermal", "Mesh", "Seamless"}, Count: 10, PriceMin: 999, PriceMax: 2499, CostRatio: 0.36, ReturnRate: 0.06, FitSensitive: true},
			{Name: "Accessories", Items: []string{"Tote Bag", "Belt", "Wallet", "Cap"}, Styles: []string{"Leather", "Canvas", "Woven", "Vegan", "Classic"}, Count: 14, PriceMin: 499, PriceMax: 1999, CostRatio: 0.33, ReturnRate: 0.03},
		},
		Suppliers:     []string{"Tirupur Knits Co.", "Jaipur Handloom Works", "Ahmedabad Weaves", "Agra Footcraft", "Ludhiana Activewear", "Bengaluru Denim Mills"},
		QualityIssue:  anchor{Category: 0, Name: "Aurora Linen Shirt"},
		Stockout:      anchor{Category: 5, Name: "Nomad Cloudstep Running Sneaker"},
		PriceAttacked: anchor{Category: 3, Name: "Metro Slim Selvedge Jeans"},
	},
	"electronics": {
		BusinessType: "electronics",
		StoreName:    "Voltcart",
		Lines:        []string{"Pulse", "Nova", "Orbit", "Flux", "Echo", "Zenith", "Arc", "Volt", "Prism", "Aero", "Quanta", "Halo"},
		Categories: []category{
			{Name: "Audio", Items: []string{"Wireless Earbuds", "Headphones", "Neckband"}, Styles: []string{"ANC", "Pro", "Lite", "Bass", "Studio"}, Count: 16, PriceMin: 1499, PriceMax: 7999, CostRatio: 0.55, ReturnRate: 0.08},
			{Name: "Wearables", Items: []string{"Smartwatch", "Fitness Band", "Smart Ring"}, Styles: []string{"AMOLED", "Sport", "Classic", "Active", "Max"}, Count: 14, PriceMin: 1999, PriceMax: 9999, CostRatio: 0.56, ReturnRate: 0.07},
			{Name: "Power", Items: []string{"Power Bank", "Fast Charger", "Charging Dock"}, Styles: []string{"20000mAh", "65W GaN", "MagLock", "Slim", "Travel"}, Count: 14, PriceMin: 799, PriceMax: 3999, CostRatio: 0.50, ReturnRate: 0.05},
			{Name: "Speakers", Items: []string{"Bluetooth Speaker", "Soundbar", "Party Speaker"}, Styles: []string{"Rugged", "Mini", "360", "Boom", "Home"}, Count: 12, PriceMin: 1499, PriceMax: 12999, CostRatio: 0.57, ReturnRate: 0.06},
			{Name: "Accessories", Items: []string{"USB-C Cable", "Phone Case", "Laptop Sleeve"}, Styles: []string{"Braided", "Armor", "Slim", "Recycled", "Matte"}, Count: 16, PriceMin: 299, PriceMax: 1499, CostRatio: 0.38, ReturnRate: 0.03},
			{Name: "Smart Home", Items: []string{"Smart Plug", "Security Camera", "Smart Bulb"}, Styles: []string{"WiFi", "2K", "Color", "Outdoor", "Mini"}, Count: 14, PriceMin: 699, PriceMax: 4999, CostRatio: 0.52, ReturnRate: 0.06},
			{Name: "Computing", Items: []string{"Wireless Mouse", "Mechanical Keyboard", "Webcam"}, Styles: []string{"Silent", "RGB", "Ergo", "1080p", "Compact"}, Count: 14, PriceMin: 899, PriceMax: 5999, CostRatio: 0.50, ReturnRate: 0.05},
		},
		Suppliers:     []string{"Shenzhen Acoustics", "Noida Assembly Hub", "Chennai Electronics", "Pune Smart Devices"},
		QualityIssue:  anchor{Category: 0, Name: "Pulse ANC Wireless Earbuds"},
		Stockout:      anchor{Category: 1, Name: "Nova AMOLED Smartwatch"},
		PriceAttacked: anchor{Category: 2, Name: "Volt 65W GaN Fast Charger"},
	},
	"beauty": {
		BusinessType: "beauty",
		StoreName:    "Dewdrop Botanics",
		Lines:        []string{"Rose", "Kumkumadi", "Neem", "Saffron", "Aloe", "Ubtan", "Vetiver", "Jasmine", "Turmeric", "Hibiscus", "Sandal", "Matcha"},
		Categories: []category{
			{Name: "Skincare", Items: []string{"Face Serum", "Moisturiser", "Face Wash"}, Styles: []string{"Vitamin C", "Hydrating", "Brightening", "Gentle", "Night"}, Count: 18, PriceMin: 399, PriceMax: 1499, CostRatio: 0.28, ReturnRate: 0.04},
			{Name: "Haircare", Items: []string{"Hair Oil", "Shampoo", "Hair Mask"}, Styles: []string{"Bhringraj", "Repair", "Volumising", "Anti-dandruff", "Silk"}, Count: 16, PriceMin: 349, PriceMax: 1199, CostRatio: 0.27, ReturnRate: 0.03},
			{Name: "Makeup", Items: []string{"Lip Tint", "Kajal", "Tinted Balm"}, Styles: []string{"Matte", "Smudge-proof", "Dewy", "Long-wear", "Sheer"}, Count: 16, PriceMin: 299, PriceMax: 999, CostRatio: 0.30, ReturnRate: 0.05},
			{Name: "Bath & Body", Items: []string{"Body Lotion", "Body Wash", "Bath Salt"}, Styles: []string{"Shea", "Citrus", "Lavender", "Oat", "Coconut"}, Count: 14, PriceMin: 349, PriceMax: 899, CostRatio: 0.26, ReturnRate: 0.03},
			{Name: "Fragrance", Items: []string{"Eau de Parfum", "Body Mist", "Attar"}, Styles: []string{"Oud", "Mogra", "Fresh", "Musk", "Amber"}, Count: 12, PriceMin: 599, PriceMax: 2499, CostRatio: 0.32, ReturnRate: 0.04},
			{Name: "Sun Care", Items: []string{"Sunscreen", "Sun Stick", "After-sun Gel"}, Styles: []string{"SPF 50", "Matte", "Tinted", "Sport", "Kids"}, Count: 12, PriceMin: 399, PriceMax: 999, CostRatio: 0.29, ReturnRate: 0.04},
			{Name: "Gift Sets", Items: []string{"Ritual Kit", "Discovery Set", "Gift Box"}, Styles: []string{"Glow", "Festive", "Travel", "Bridal", "Mini"}, Count: 12, PriceMin: 999, PriceMax: 2999, CostRatio: 0.33, ReturnRate: 0.03},
		},
		Suppliers:     []string{"Kannauj Botanicals", "Baddi Formulations", "Kerala Ayur Labs", "Vapi Cosmetics"},
		QualityIssue:  anchor{Category: 0, Name: "Rose Vitamin C Face Serum"},
		Stockout:      anchor{Category: 1, Name: "Neem Bhringraj Hair Oil"},
		PriceAttacked: anchor{Category: 5, Name: "Aloe SPF 50 Sunscreen"},
	},
	"home": {
		BusinessType: "home",
		StoreName:    "Hearth & Loom",
		Lines:        []string{"Banyan", "Terra", "Lotus", "Cedar", "Monsoon", "Indus", "Juniper", "Coral", "Slate", "Sage", "Amber", "Kesar"},
		Categories: []category{
			{Name: "Bedding", Items: []string{"Bedsheet Set", "Duvet Cover", "Quilt"}, Styles: []string{"Percale", "Linen", "Sateen", "Jaipuri", "Organic"}, Count: 16, PriceMin: 1299, PriceMax: 4999, CostRatio: 0.40, ReturnRate: 0.06},
			{Name: "Kitchen", Items: []string{"Cookware Set", "Kadai", "Tawa"}, Styles: []string{"Cast Iron", "Tri-ply", "Ceramic", "Copper", "Nonstick"}, Count: 16, PriceMin: 899, PriceMax: 5999, CostRatio: 0.45, ReturnRate: 0.05},
			{Name: "Decor", Items: []string{"Table Lamp", "Wall Art", "Vase"}, Styles: []string{"Terracotta", "Brass", "Rattan", "Marble", "Handpainted"}, Count: 14, PriceMin: 699, PriceMax: 3999, CostRatio: 0.38, ReturnRate: 0.07},
			{Name: "Bath", Items: []string{"Towel Set", "Bath Mat", "Bathrobe"}, Styles: []string{"Turkish", "Bamboo", "Waffle", "Zero-twist", "Cotton"}, Count: 14, PriceMin: 599, PriceMax: 2499, CostRatio: 0.36, ReturnRate: 0.04},
			{Name: "Dining", Items: []string{"Dinner Set", "Glass Set", "Serving Bowl"}, Styles: []string{"Stoneware", "Porcelain", "Hammered", "Speckled", "Matte"}, Count: 14, PriceMin: 799, PriceMax: 4999, CostRatio: 0.42, ReturnRate: 0.08},
			{Name: "Storage", Items: []string{"Basket", "Organiser", "Jar Set"}, Styles: []string{"Seagrass", "Bamboo", "Glass", "Jute", "Steel"}, Count: 12, PriceMin: 399, PriceMax: 1999, CostRatio: 0.35, ReturnRate: 0.03},
			{Name: "Furnishing", Items: []string{"Cushion Cover", "Curtain", "Rug"}, Styles: []string{"Velvet", "Ikat", "Dhurrie", "Boucle", "Embroidered"}, Count: 14, PriceMin: 499, PriceMax: 5999, CostRatio: 0.39, ReturnRate: 0.05},
		},
		Suppliers:     []string{"Panipat Textiles", "Moradabad Metalworks", "Khurja Ceramics", "Karur Home Linen"},
		QualityIssue:  anchor{Category: 0, Name: "Banyan Percale Bedsheet Set"},
		Stockout:      anchor{Category: 1, Name: "Terra Cast Iron Kadai"},
		PriceAttacked: anchor{Category: 4, Name: "Lotus Stoneware Dinner Set"},
	},
	"grocery": {
		BusinessType: "grocery",
		StoreName:    "Harvest Basket",
		Lines:        []string{"Farm", "Organic", "Village", "Heritage", "Daily", "Pure", "Valley", "Golden", "Green", "Native", "Sunrise", "Ganga"},
		Categories: []category{
			{Name: "Staples", Items: []string{"Basmati Rice", "Atta", "Toor Dal"}, Styles: []string{"Aged", "Stone-ground", "Unpolished", "Premium", "Classic"}, Count: 16, PriceMin: 199, PriceMax: 899, CostRatio: 0.68, ReturnRate: 0.02},
			{Name: "Oils & Ghee", Items: []string{"Cold-pressed Oil", "A2 Ghee", "Mustard Oil"}, Styles: []string{"Wood-pressed", "Bilona", "Kachi Ghani", "Virgin", "Classic"}, Count: 14, PriceMin: 299, PriceMax: 1499, CostRatio: 0.66, ReturnRate: 0.02},
			{Name: "Snacks", Items: []string{"Millet Chips", "Trail Mix", "Makhana"}, Styles: []string{"Peri Peri", "Roasted", "Masala", "Himalayan Salt", "Jaggery"}, Count: 16, PriceMin: 99, PriceMax: 499, CostRatio: 0.55, ReturnRate: 0.02},
			{Name: "Beverages", Items: []string{"Green Tea", "Filter Coffee", "Kombucha"}, Styles: []string{"Tulsi", "Chicory-blend", "Ginger", "Darjeeling", "Cold Brew"}, Count: 14, PriceMin: 149, PriceMax: 799, CostRatio: 0.52, ReturnRate: 0.02},
			{Name: "Spices", Items: []string{"Garam Masala", "Turmeric", "Chilli Powder"}, Styles: []string{"Lakadong", "Kashmiri", "Hand-pounded", "Single-origin", "Classic"}, Count: 14, PriceMin: 99, PriceMax: 499, CostRatio: 0.50, ReturnRate: 0.01},
			{Name: "Breakfast", Items: []string{"Muesli", "Oats", "Granola"}, Styles: []string{"Crunchy", "Steel-cut", "No-sugar", "Berry", "Nut"}, Count: 14, PriceMin: 199, PriceMax: 699, CostRatio: 0.58, ReturnRate: 0.02},
			{Name: "Sweeteners", Items: []string{"Jaggery", "Honey", "Coconut Sugar"}, Styles: []string{"Raw", "Forest", "Powdered", "Organic", "Wildflower"}, Count: 12, PriceMin: 149, PriceMax: 699, CostRatio: 0.57, ReturnRate: 0.02},
		},
		Suppliers:     []string{"Punjab Agro Mills", "Kerala Spice Co-op", "Nashik Farmers FPO", "Coorg Estates"},
		QualityIssue:  anchor{Category: 1, Name: "Village Bilona A2 Ghee"},
		Stockout:      anchor{Category: 2, Name: "Farm Roasted Makhana"},
		PriceAttacked: anchor{Category: 0, Name: "Heritage Aged Basmati Rice"},
	},
}

func catalogFor(businessType string) catalog {
	if c, ok := catalogs[businessType]; ok {
		return c
	}
	c := catalogs["fashion"]
	c.BusinessType = businessType
	return c
}

type geo struct {
	State  string
	Region string
	Cities []string
	Weight float64
}

var geos = []geo{
	{"Maharashtra", "West", []string{"Mumbai", "Pune", "Nagpur", "Nashik"}, 15},
	{"Karnataka", "South", []string{"Bengaluru", "Mysuru", "Mangaluru"}, 12},
	{"Delhi", "North", []string{"New Delhi", "Dwarka", "Rohini"}, 11},
	{"Tamil Nadu", "South", []string{"Chennai", "Coimbatore", "Madurai"}, 9},
	{"Telangana", "South", []string{"Hyderabad", "Warangal"}, 8},
	{"Uttar Pradesh", "North", []string{"Lucknow", "Noida", "Kanpur", "Varanasi"}, 8},
	{"Gujarat", "West", []string{"Ahmedabad", "Surat", "Vadodara"}, 7},
	{"West Bengal", "East", []string{"Kolkata", "Howrah", "Siliguri"}, 7},
	{"Haryana", "North", []string{"Gurugram", "Faridabad"}, 5},
	{"Kerala", "South", []string{"Kochi", "Thiruvananthapuram", "Kozhikode"}, 4},
	{"Rajasthan", "North", []string{"Jaipur", "Udaipur", "Jodhpur"}, 4},
	{"Madhya Pradesh", "Central", []string{"Indore", "Bhopal"}, 3},
	{"Odisha", "East", []string{"Bhubaneswar", "Cuttack"}, 2.5},
	{"Bihar", "East", []string{"Patna", "Gaya"}, 2.5},
	{"Punjab", "North", []string{"Ludhiana", "Amritsar", "Mohali"}, 2.5},
	{"Assam", "Northeast", []string{"Guwahati", "Dibrugarh"}, 1.5},
	{"Andhra Pradesh", "South", []string{"Visakhapatnam", "Vijayawada"}, 3},
	{"Chhattisgarh", "Central", []string{"Raipur"}, 1},
	{"Jharkhand", "East", []string{"Ranchi", "Jamshedpur"}, 1.5},
	{"Goa", "West", []string{"Panaji", "Margao"}, 1},
}

var firstNames = []string{"Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan", "Rohan", "Ananya", "Diya", "Aadhya", "Saanvi", "Pari", "Myra", "Ira", "Kavya", "Meera", "Riya", "Neha", "Priya", "Sneha", "Pooja", "Rahul", "Karan", "Nikhil", "Varun", "Siddharth", "Aman", "Tanvi", "Shreya", "Nandini", "Lakshmi", "Harini", "Deepak", "Manish", "Suresh", "Ravi", "Farhan", "Zoya", "Imran", "Ayesha", "Gurpreet", "Simran", "Harpreet", "Joseph", "Maria", "Anil", "Kiran", "Sunita", "Vikram", "Abhishek", "Divya", "Pallavi", "Rakesh", "Swati", "Tejas", "Yash", "Mehul"}
var lastNames = []string{"Sharma", "Verma", "Iyer", "Reddy", "Nair", "Patel", "Shah", "Gupta", "Singh", "Kumar", "Das", "Banerjee", "Mukherjee", "Rao", "Pillai", "Menon", "Joshi", "Kulkarni", "Deshpande", "Chopra", "Malhotra", "Kapoor", "Agarwal", "Bose", "Ghosh", "Khan", "Siddiqui", "Fernandes", "D'Souza", "Naidu", "Hegde", "Shetty", "Chauhan", "Yadav", "Mishra", "Pandey", "Tiwari", "Saxena", "Bhatt", "Krishnan"}

var couriers = []string{"Swiftline", "BlueRoute", "Parcelo", "Northstar", "Dashway"}
var courierWeight = []float64{30, 24, 20, 14, 12}
