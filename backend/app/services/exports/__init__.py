"""Exports sub-package.

Hosts pure builder modules that turn domain projections into export bytes
(`.xlsx`, etc.) without performing any I/O of their own. The orchestrating
service decides what to build and where to put the result; this package
only knows how to build.
"""
