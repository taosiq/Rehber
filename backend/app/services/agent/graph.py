"""LangGraph agent: the model thinks, optionally calls tools, then answers.

    START -> agent --(tool calls?)--> tools -> agent -> ... -> END
"""

from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

MAX_STEPS = 12  # safety cap on agent <-> tool round trips


def build_agent(model: BaseChatModel, tools: list[BaseTool]):
    bound = model.bind_tools(tools) if tools else model

    async def agent(state: MessagesState):
        return {"messages": [await bound.ainvoke(state["messages"])]}

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent)
    graph.add_edge(START, "agent")
    if tools:
        graph.add_node("tools", ToolNode(tools, handle_tool_errors=True))
        graph.add_conditional_edges("agent", tools_condition, {"tools": "tools", END: END})
        graph.add_edge("tools", "agent")
    else:
        graph.add_edge("agent", END)
    return graph.compile()
