CARDS = [
    {
        "text": "Add to cart at 2 am?",
        "personality": "Midnight Cart Goblin",
        "line": "Your cart does its best work after midnight.",
    },
    {
        "text": "'I deserve this' after a bad day?",
        "personality": "Treat Yourself Repeat Offender",
        "line": "Every bad day comes with a receipt.",
    },
    {
        "text": "A $7 coffee every single morning?",
        "personality": "Latte Leak",
        "line": "Small cups. Big totals.",
    },
    {
        "text": "A subscription you forgot you have?",
        "personality": "Subscription Hoarder",
        "line": "You're paying for things you forgot exist.",
    },
    {
        "text": "Can't say no when friends say 'let's go out'?",
        "personality": "Social Butterfly (Wallet Moth)",
        "line": "Can't say no, can't stop paying.",
    },
    {
        "text": "You check your balance before buying gum?",
        "personality": "Secret Chindi",
        "line": "You were born for this app.",
    },
]


def score(answers):
    scores = [2 if a else 0 for a in answers]
    scores[-1] += sum(not a for a in answers)
    return {**CARDS[max(range(6), key=lambda i: scores[i])], "scores": scores}
