"""Disposable deterministic external workflow; no model/provider credentials."""
import asyncio
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
class State(TypedDict):
    value: str
async def work(state: State):
    await asyncio.sleep(1)
    return {"value": "external:" + state["value"]}
builder = StateGraph(State)
builder.add_node("work", work)
builder.add_edge(START, "work")
builder.add_edge("work", END)
graph = builder.compile()
