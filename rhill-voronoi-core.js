/*!
Author: Raymond Hill (rhill@raymondhill.net)
File: rhill-voronoi-core.js
Version: 0.96
Date: May 26, 2011
Description: This is my personal Javascript implementation of
Steven Fortune's algorithm to compute Voronoi diagrams.

Copyright (C) 2010,2011 Raymond Hill
https://github.com/gorhill/Javascript-Voronoi

Licensed under The MIT License
http://en.wikipedia.org/wiki/MIT_License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*****

Portions of this software use, depend, or was inspired by the work of:

  "Fortune's algorithm" by Steven J. Fortune: For his clever
  algorithm to compute Voronoi diagrams.
  http://ect.bell-labs.com/who/sjf/

  "The Liang-Barsky line clipping algorithm in a nutshell!" by Daniel White,
  to efficiently clip a line within a rectangle.
  http://www.skytopia.com/project/articles/compsci/clipping.html

  "rbtree" by Franck Bui-Huu
  https://github.com/fbuihuu/libtree/blob/master/rb.c
  I ported to Javascript the C code of a Red-Black tree implementation by
  Franck Bui-Huu, and further altered the code for Javascript efficiency
  and to very specifically fit the purpose of holding the beachline (the key
  is a variable range rather than an unmutable data point), and unused
  code paths have been removed. Each node in the tree is actually a beach
  section on the beachline. Using a tree structure for the beachline remove
  the need to lookup the beach section in the array at removal time, as
  now a circle event can safely hold a reference to its associated
  beach section (thus findDeletionPoint() is no longer needed). This
  finally take care of nagging finite arithmetic precision issues arising
  at lookup time, such that epsilon could be brought down to 1e-9 (from 1e-4).
  rhill 2011-05-27: added a 'previous' and 'next' members which keeps track
  of previous and next nodes, and remove the need for Beachsection.getPrevious()
  and Beachsection.getNext().

*****

History:

0.96 (26 May 2011):
  Returned diagram.cells is now an array, whereas the index of a cell
  matches the index of its associated site in the array of sites passed
  to Voronoi.compute(). This allowed some gain in performance. The
  'voronoiId' member is still used internally by the Voronoi object.
  The Voronoi.Cells object is no longer necessary and has been removed.

0.95 (19 May 2011):
  No longer using Javascript array to keep track of the beach sections of
  the beachline, now using Red-Black tree.

  The move to a binary tree was unavoidable, as I ran into finite precision
  arithmetic problems when I started to use sites with fractional values.
  The problem arose when the code had to find the arc associated with a
  triggered Fortune circle event: the collapsing arc was not always properly
  found due to finite precision arithmetic-related errors. Using a tree structure
  eliminate the need to look-up a beachsection in the array structure
  (findDeletionPoint()), and allowed to bring back epsilon down to 1e-9.

0.91(21 September 2010):
  Lower epsilon from 1e-5 to 1e-4, to fix problem reported at
  http://www.raymondhill.net/blog/?p=9#comment-1414

0.90 (21 September 2010):
  First version.

*****

Usage:

  var sites = [{x:300,y:300}, {x:100,y:100}, {x:200,y:500}, {x:250,y:450}, {x:600,y:150}];
  // xl, xr means x left, x right
  // yt, yb means y top, y bottom
  var bbox = {xl:0, xr:800, yt:0, yb:600};
  var voronoi = new Voronoi();
  // pass an object which exhibits xl, xr, yt, yb properties. The bounding
  // box will be used to connect unbound edges, and to close open cells
  result = voronoi.compute(sites, bbox);
  // render, further analyze, etc.

Return value:
  An object with the following properties:

  result.edges = an array of unordered, unique Voronoi.Edge objects making up the Voronoi diagram.
  result.cells = an array of Voronoi.Cell object making up the Voronoi diagram. A Cell object
    might have an empty array of halfedges, meaning no Voronoi cell could be computed for a
    particular cell.
  result.execTime = the time it took to compute the Voronoi diagram, in milliseconds.

Voronoi.Edge object:
  lSite: the Voronoi site object at the left of this Voronoi.Edge object.
  rSite: the Voronoi site object at the right of this Voronoi.Edge object (can be null).
  va: an object with an 'x' and a 'y' property defining the start point
    (relative to the Voronoi site on the left) of this Voronoi.Edge object.
  vb: an object with an 'x' and a 'y' property defining the end point
    (relative to Voronoi site on the left) of this Voronoi.Edge object.

  For edges which are used to close open cells (using the supplied bounding box), the
  rSite property will be null.

Voronoi.Cell object:
  site: the Voronoi site object associated with the Voronoi cell.
  halfedges: an array of Voronoi.Halfedge objects, ordered counterclockwise, defining the
    polygon for this Voronoi cell.

Voronoi.Halfedge object:
  site: the Voronoi site object owning this Voronoi.Halfedge object.
  edge: a reference to the unique Voronoi.Edge object underlying this Voronoi.Halfedge object.
  getStartpoint(): a method returning an object with an 'x' and a 'y' property for
    the start point of this halfedge. Keep in mind halfedges are always countercockwise.
  getEndpoint(): a method returning an object with an 'x' and a 'y' property for
    the end point of this halfedge. Keep in mind halfedges are always countercockwise.

TODO: Identify opportunities for performance improvement.
TODO: Let the user close the Voronoi cells, do not do it automatically. Not only let
      him close the cells, but also allow him to close more than once using a different
      bounding box for the same Voronoi diagram.
*/

/*global Math */

function Voronoi() {
	this.siteEvents = [];
	this.circEvents = [];
	this.edges = null;
	this.cells = null;
	this.beachline = null;
	this.numBeachsections = 0;
	this.beachsectionJunkyard = [];
	}

Voronoi.prototype.VOID_EVENT = 0; // Code depends on Boolean(Voronoi.VOID_EVENT) to be false
Voronoi.prototype.SITE_EVENT = 1;
Voronoi.prototype.CIRCLE_EVENT = 2;
Voronoi.prototype.sqrt = Math.sqrt;
Voronoi.prototype.abs = Math.abs;
Voronoi.prototype.EPSILON = 1e-9;
Voronoi.prototype.equalWithEpsilon = function(a,b){return this.abs(a-b)<1e-9;};
Voronoi.prototype.greaterThanWithEpsilon = function(a,b){return a-b>1e-9;};
Voronoi.prototype.greaterThanOrEqualWithEpsilon = function(a,b){return b-a<1e-9;};
Voronoi.prototype.lessThanWithEpsilon = function(a,b){return b-a>1e-9;};
Voronoi.prototype.lessThanOrEqualWithEpsilon = function(a,b){return a-b<1e-9;};
Voronoi.prototype.verticesAreEqual = function(a,b) {return this.abs(a.x-b.x)<1e-9 && this.abs(a.y-b.y)<1e-9;};

// Beachsection object
Voronoi.prototype.Beachsection = function(site) {
	this.site = site;
	};

Voronoi.prototype.Beachsection.prototype.init = function(site) {
	this.site = site;
	this.edge =
	this.circleEvent =
	this.parent =
	this.left =
	this.right =
	this.previous =
	this.next = null;
	this.isRed = false;
	return this;
	};

// Red-Black tree code
Voronoi.prototype.Beachsection.prototype.getFirst = function() {
	var node = this;
	while (node.left) {
		node = node.left;
		}
	return node;
	};

// Red-Black tree code
Voronoi.prototype.Beachsection.prototype.getLast = function() {
	var node = this;
	while (node.right) {
		node = node.right;
		}
	return node;
	};

Voronoi.prototype.resetBeachline = function() {
	// Move leftover beachsections to the beachsection junkyard.
	if (this.beachline) {
		var beachsection = this.beachline.getFirst();
		while (beachsection) {
			this.beachsectionJunkyard.push(beachsection); // mark for reuse
			beachsection = beachsection.next;
			}
		}
	this.beachline = null;
	this.numBeachsections = 0;
	};

// rhill 2011-06-02: A lot of Beachsection instanciations
// occur during the computation of the Voronoi diagram,
// somewhere between the number of sites and twice the
// number of sites, while the number of Beachsections on the
// beachline at any given time is comparatively low. For this
// reason, we reuse already created Beachsections, in order
// to avoid new memory allocation. This resulted in a measurable
// performance gain.
Voronoi.prototype.createBeachsection = function(site) {
	var arc = this.beachsectionJunkyard.pop();
	if (arc) {
		return arc.init(site);
		}
	return new this.Beachsection(site);
	};

Voronoi.prototype.destroyBeachsection = function(arc) {
	this._removeBeachsection(arc); // remove from RB-tree
	this.beachsectionJunkyard.push(arc); // mark for reuse
	};

// Red-Black tree code
Voronoi.prototype._insertBeachsection = function(node, successor) {
	this.numBeachsections++;
	var parent;
	if (node) {
		// >>> rhill 2011-05-27: Performance: cache previous/next nodes
		successor.previous = node;
		successor.next = node.next;
		if (node.next) {
			node.next.previous = successor;
			}
		node.next = successor;
		// <<<
		if (node.right) {
			// in-place expansion of node.right.getFirst();
			node = node.right;
			while (node.left) {node = node.left;}
			node.left = successor;
			}
		else {
			node.right = successor;
			}
		parent = node;
		}
	else {
		this.beachline = successor;
		parent = null;
		}
	successor.left = successor.right = null;
	successor.parent = parent;
	successor.isRed = true;
	// Fixup the modified tree by recoloring nodes and performing
	// rotations (2 at most) hence the red-black tree properties are
	// preserved.
	var grandpa, uncle;
	node = successor;
	while (parent && parent.isRed) {
		grandpa = parent.parent;
		if (parent === grandpa.left) {
			uncle = grandpa.right;
			if (uncle && uncle.isRed) {
				parent.isRed = uncle.isRed = false;
				grandpa.isRed = true;
				node = grandpa;
				}
			else {
				if (node === parent.right) {
					this._rotateBeachsectionLeft(parent);
					node = parent;
					parent = node.parent;
					}
				parent.isRed = false;
				grandpa.isRed = true;
				this._rotateBeachsectionRight(grandpa);
				}
			}
		else {
			uncle = grandpa.left;
			if (uncle && uncle.isRed) {
				parent.isRed = uncle.isRed = false;
				grandpa.isRed = true;
				node = grandpa;
				}
			else {
				if (node === parent.left) {
					this._rotateBeachsectionRight(parent);
					node = parent;
					parent = node.parent;
					}
				parent.isRed = false;
				grandpa.isRed = true;
				this._rotateBeachsectionLeft(grandpa);
				}
			}
		parent = node.parent;
		}
	this.beachline.isRed = false;
	};

// Red-Black tree code
Voronoi.prototype._removeBeachsection = function(node) {
	this.numBeachsections--;
	// >>> rhill 2011-05-27: Performance: cache previous/next nodes
	if (node.next) {
		node.next.previous = node.previous;
		}
	if (node.previous) {
		node.previous.next = node.next;
		}
	node.next = node.previous = null;
	// <<<
	var parent = node.parent,
		left = node.left,
		right = node.right,
		next;
	if (!left) {
		next = right;
		}
	else if (!right) {
		next = left;
		}
	else {
		next = right.getFirst();
		}
	if (parent) {
		if (parent.left === node) {
			parent.left = next;
			}
		else {
			parent.right = next;
			}
		}
	else {
		this.beachline = next;
		}
	// enforce red-black rules
	var isRed;
	if (left && right) {
		isRed = next.isRed;
		next.isRed = node.isRed;
		next.left = left;
		left.parent = next;
		if (next !== right) {
			parent = next.parent;
			next.parent = node.parent;
			node = next.right;
			parent.left = node;
			next.right = right;
			right.parent = next;
			}
		else {
			next.parent = parent;
			parent = next;
			node = next.right;
			}
		}
	else {
		isRed = node.isRed;
		node = next;
		}
	// 'node' is now the sole successor's child and 'parent' its
	// new parent (since the successor can have been moved)
	if (node) {
		node.parent = parent;
		}
	// the 'easy' cases
	if (isRed) {return;}
	if (node && node.isRed) {
		node.isRed = false;
		return;
		}
	// the other cases
	var sibling;
	do {
		if (node === this.beachline) {
			break;
			}
		if (node === parent.left) {
			sibling = parent.right;
			if (sibling.isRed) {
				sibling.isRed = false;
				parent.isRed = true;
				this._rotateBeachsectionLeft(parent);
				sibling = parent.right;
				}
			if ((sibling.left && sibling.left.isRed) || (sibling.right && sibling.right.isRed)) {
				if (!sibling.right || !sibling.right.isRed) {
					sibling.left.isRed = false;
					sibling.isRed = true;
					this._rotateBeachsectionRight(sibling);
					sibling = parent.right;
					}
				sibling.isRed = parent.isRed;
				parent.isRed = sibling.right.isRed = false;
				this._rotateBeachsectionLeft(parent);
				node = this.beachline;
				break;
				}
			}
		else {
			sibling = parent.left;
			if (sibling.isRed) {
				sibling.isRed = false;
				parent.isRed = true;
				this._rotateBeachsectionRight(parent);
				sibling = parent.left;
				}
			if ((sibling.left && sibling.left.isRed) || (sibling.right && sibling.right.isRed)) {
				if (!sibling.left || !sibling.left.isRed) {
					sibling.right.isRed = false;
					sibling.isRed = true;
					this._rotateBeachsectionLeft(sibling);
					sibling = parent.left;
					}
				sibling.isRed = parent.isRed;
				parent.isRed = sibling.left.isRed = false;
				this._rotateBeachsectionRight(parent);
				node = this.beachline;
				break;
				}
			}
		sibling.isRed = true;
		node = parent;
		parent = parent.parent;
	} while (!node.isRed);
	if (node) {node.isRed = false;}
	};

// Red-Black tree code
Voronoi.prototype._rotateBeachsectionLeft = function(node) {
	var p = node,
		q = node.right, // can't be null
		parent = p.parent;
	if (parent) {
		if (parent.left === p) {
			parent.left = q;
			}
		else {
			parent.right = q;
			}
		}
	else {
		this.beachline = q;
		}
	q.parent = parent;
	p.parent = q;
	p.right = q.left;
	if (p.right) {
		p.right.parent = p;
		}
	q.left = p;
	};

// Red-Black tree code
Voronoi.prototype._rotateBeachsectionRight = function(node) {
	var p = node,
		q = node.left, // can't be null
		parent = p.parent;
	if (parent) {
		if (parent.left === p) {
			parent.left = q;
			}
		else {
			parent.right = q;
			}
		}
	else {
		this.beachline = q;
		}
	q.parent = parent;
	p.parent = q;
	p.left = q.right;
	if (p.left) {
		p.left.parent = p;
		}
	q.right = p;
	};

Voronoi.prototype.Edge = function(lSite, rSite) {
	this.lSite = lSite;
	this.rSite = rSite;
	this.va = this.vb = null;
	};

Voronoi.prototype.Halfedge = function(edge, lSite, rSite) {
	this.site = lSite;
	this.edge = edge;
	// 'angle' is a value to be used for properly sorting the
	// halfsegments counterclockwise. By convention, we will
	// use the angle of the line defined by the 'site to the left'
	// to the 'site to the right'.
	// However, border edges have no 'site to the right': thus we
	// use the angle of line perpendicular to the halfsegment (the
	// edge should have both end points defined in such case.)
	if (rSite) {
		this.angle = Math.atan2(rSite.y-lSite.y, rSite.x-lSite.x);
		}
	else {
		var va = edge.va,
			vb = edge.vb;
		// rhill 2011-05-31: used to call getStartpoint()/getEndpoint(),
		// but for performance purpose, these are expanded in place here.
		this.angle = edge.lSite === lSite ? Math.atan2(vb.x-va.x, va.y-vb.y)
		                                  : Math.atan2(va.x-vb.x, vb.y-va.y);
		}
	};

Voronoi.prototype.Cell = function(site) {
	this.site = site;
	this.halfedges = [];
	};

Voronoi.prototype.Cell.prototype.prepare = function() {
	var halfedges = this.halfedges,
		iHalfedge = halfedges.length,
		edge;
	// get rid of unused halfedges
	// rhill 2011-05-27: Keep it simple, no point here in trying
	// to be fancy: dangling edges are a typically a minority.
	while (iHalfedge--) {
		edge = halfedges[iHalfedge].edge;
		if (!edge.vb || !edge.va) {
			halfedges.splice(iHalfedge,1);
			}
		}
	// rhill 2011-05-26: I tried to use a binary search at insertion
	// time to keep the array sorted on-the-fly (in Cell.addHalfedge()).
	// There was no real benefits in doing so, performance on
	// Firefox 3.6 was improved marginally, while performance on
	// Opera 11 was penalized marginally.
	halfedges.sort(function(a,b){return b.angle-a.angle;});
	return halfedges.length;
	};

// prototype our inner classes, more efficient than having these Javascript
// properties repeated for all instances.

Voronoi.prototype.Halfedge.prototype.getStartpoint = function() {
	return this.edge.lSite === this.site ? this.edge.va : this.edge.vb;
	};

Voronoi.prototype.Halfedge.prototype.getEndpoint = function() {
	return this.edge.lSite === this.site ? this.edge.vb : this.edge.va;
	};

//
// Fortune algorithm methods
//

// calculate the left break point of a particular beach section,
// given a particular sweep line
Voronoi.prototype.leftBreakPoint = function(arc, directrix) {
	// http://en.wikipedia.org/wiki/Parabola
	// http://en.wikipedia.org/wiki/Quadratic_equation
	// h1 = x1,
	// k1 = (y1+directrix)/2,
	// h2 = x2,
	// k2 = (y2+directrix)/2,
	// p1 = k1-directrix,
	// a1 = 1/(4*p1),
	// b1 = -h1/(2*p1),
	// c1 = h1*h1/(4*p1)+k1,
	// p2 = k2-directrix,
	// a2 = 1/(4*p2),
	// b2 = -h2/(2*p2),
	// c2 = h2*h2/(4*p2)+k2,
	// x = (-(b2-b1) + Math.sqrt((b2-b1)*(b2-b1) - 4*(a2-a1)*(c2-c1))) / (2*(a2-a1))
	// When x1 become the x-origin:
	// h1 = 0,
	// k1 = (y1+directrix)/2,
	// h2 = x2-x1,
	// k2 = (y2+directrix)/2,
	// p1 = k1-directrix,
	// a1 = 1/(4*p1),
	// b1 = 0,
	// c1 = k1,
	// p2 = k2-directrix,
	// a2 = 1/(4*p2),
	// b2 = -h2/(2*p2),
	// c2 = h2*h2/(4*p2)+k2,
	// x = (-b2 + Math.sqrt(b2*b2 - 4*(a2-a1)*(c2-k1))) / (2*(a2-a1)) + x1

	// change code below at your own risk: care has been taken to
	// reduce errors due to computers' finite arithmetic precision.
	// Maybe can still be improved, will see if any more of this
	// kind of errors pop up again.
	var site = arc.site,
		rfocx = site.x,
		rfocy = site.y,
		pby2 = rfocy-directrix;
	// parabola in degenerate case where focus is on directrix
	if (!pby2) {
		return rfocx;
		}
	var lArc = arc.previous;
	if (!lArc) {
		return -Infinity;
		}
	site = lArc.site;
	var lfocx = site.x,
		lfocy = site.y,
		plby2 = lfocy-directrix;
	// parabola in degenerate case where focus is on directrix
	if (!plby2) {
		return lfocx;
		}
	var	hl = lfocx-rfocx,
		aby2 = 1/pby2-1/plby2,
		b = hl/plby2;
	if (aby2) {
		return (-b+this.sqrt(b*b-2*aby2*(hl*hl/(-2*plby2)-lfocy+plby2/2+rfocy-pby2/2)))/aby2+rfocx;
		}
	// both parabolas have same distance to directrix, thus break point is midway
	return (rfocx+lfocx)/2;
	};

// calculate the right break point of a particular beach section,
// given a particular directrix
Voronoi.prototype.rightBreakPoint = function(arc, directrix) {
	var rArc = arc.next;
	if (rArc) {
		return this.leftBreakPoint(rArc, directrix);
		}
	var site = arc.site;
	return site.y === directrix ? site.x : Infinity;
	};

// this create and add an edge to internal collection, and also create
// two halfedges which are added to each site's counterclockwise array
// of halfedges.
Voronoi.prototype.createEdge = function(lSite, rSite, va, vb) {
	var edge = new this.Edge(lSite, rSite);
	this.edges.push(edge);
	if (va) {
		this.setEdgeStartpoint(edge, lSite, rSite, va);
		}
	if (vb) {
		this.setEdgeEndpoint(edge, lSite, rSite, vb);
		}
	this.cells[lSite.voronoiId].halfedges.push(new this.Halfedge(edge, lSite, rSite));
	this.cells[rSite.voronoiId].halfedges.push(new this.Halfedge(edge, rSite, lSite));
	return edge;
	};

Voronoi.prototype.createBorderEdge = function(lSite, va, vb) {
	var edge = new this.Edge(lSite, null);
	edge.va = va;
	edge.vb = vb;
	this.edges.push(edge);
	return edge;
	};

Voronoi.prototype.setEdgeStartpoint = function(edge, lSite, rSite, vertex) {
	if (!edge.va && !edge.vb) {
		edge.va = vertex;
		edge.lSite = lSite;
		edge.rSite = rSite;
		}
	else if (edge.lSite === rSite) {
		edge.vb = vertex;
		}
	else {
		edge.va = vertex;
		}
	};

Voronoi.prototype.setEdgeEndpoint = function(edge, lSite, rSite, vertex) {
	this.setEdgeStartpoint(edge, rSite, lSite, vertex);
	};

Voronoi.prototype.removeBeachsection = function(event) {
	var x = event.x,
		y = event.ycenter,
		vertex = {x:x, y:y},
		disappearingTransitions = [event.arc];
	// there could be more than one empty arc at the deletion point, this
	// happens when more than two edges are linked by the same vertex,
	// so we will collect all those edges by looking up both sides of
	// the deletion point.
	// by the way, there is *always* a predecessor/successor to any collapsed
	// beach section, it's just impossible to have a collapsing first/last
	// beach sections on the beachline, since they obviously are unconstrained
	// on their left/right side.
	// look left
	var lArc = event.arc.previous;
	while (lArc.circleEvent && this.abs(x-lArc.circleEvent.x)<1e-9 && this.abs(y-lArc.circleEvent.ycenter)<1e-9) {
		disappearingTransitions.unshift(lArc);
		this.voidCircleEvent(lArc);
		lArc = lArc.previous;
		}
	// even though it is not disappearing, I will also add the beach section
	// immediately to the left of the left-most collapsed beach section, for
	// convenience, since we need to refer to it later as this beach section
	// is the 'left' site of an edge for which a start point is set.
	disappearingTransitions.unshift(lArc);
	this.voidCircleEvent(lArc);
	// look right
	var rArc = event.arc.next;
	while (rArc.circleEvent && this.abs(x-rArc.circleEvent.x)<1e-9 && this.abs(y-rArc.circleEvent.ycenter)<1e-9) {
		disappearingTransitions.push(rArc);
		this.voidCircleEvent(rArc);
		rArc = rArc.next;
		}
	// we also have to add the beach section immediately to the right of the
	// right-most collapsed beach section, since there is also a disappearing
	// transition representing an edge's start point on its left.
	disappearingTransitions.push(rArc);
	this.voidCircleEvent(rArc);
	// walk through all the disappearing transitions between beach sections and
	// set the start point of their (implied) edge.
	var nArcs = disappearingTransitions.length,
		iArc;
	for (iArc=1; iArc<nArcs; iArc++) {
		rArc = disappearingTransitions[iArc];
		lArc = disappearingTransitions[iArc-1];
		this.setEdgeStartpoint(rArc.edge, lArc.site, rArc.site, vertex);
		}

	// removed collapsed beach sections from beachline.
	// *don't forget*, the first and last beach section in our local array
	// are *not* collapsing, so we won't remove these.
	for (iArc=1; iArc<nArcs-1; iArc++) {
		this.destroyBeachsection(disappearingTransitions[iArc]);
		}

	// create a new edge as we have now a new transition between
	// two beach sections which were previously not adjacent.
	// since this edge appears as a new vertex is defined, the vertex
	// actually define an end point of the edge (relative to the site
	// on the left)
	lArc = disappearingTransitions[0];
	rArc = disappearingTransitions[nArcs-1];
	rArc.edge = this.createEdge(lArc.site, rArc.site, undefined, vertex);

	// create circle events if any for beach sections left in the beachline
	// adjacent to collapsed sections
	this.addCircleEvent(lArc);
	this.addCircleEvent(rArc);
	};

Voronoi.prototype.addBeachsection = function(site) {
	var x = site.x,
		directrix = site.y;

	// create a new beach section object for the site
	var newArc = this.createBeachsection(site);

	// find the left and right beach sections which will surround the newly
	// created beach section.
	// rhill 2011-06-01: This loop is one of the most often executed,
	// hence we expand in-place the comparison-against-epsilon calls.
	var lArc, rArc,
		dxl, dxr,
		node = this.beachline;
	while (node) {
		dxl = this.leftBreakPoint(node,directrix)-x;
		// x lessThanWithEpsilon xl => falls somewhere before the left edge of the beachsection
		if (dxl > 1e-9) {
			node = node.left;
			}
		else {
			dxr = x-this.rightBreakPoint(node,directrix);
			// x greaterThanWithEpsilon xr => falls somewhere after the right edge of the beachsection
			if (dxr > 1e-9) {
				node = node.right;
				}
			else {
				// x equalWithEpsilon xl => falls exactly on the left edge of the beachsection
				if (dxl > -1e-9) {
					lArc = node.previous;
					rArc = node;
					}
				// x equalWithEpsilon xr => falls exactly on the right edge of the beachsection
				else if (dxr > 1e-9) {
					lArc = node;
					rArc = node.next;
					}
				// falls exactly somewhere in the middle of the beachsection
				else {
					lArc = rArc = node;
					}
				break;
				}
			}
		}
	// at this point, keep in mind that lArc and/or rArc could be
	// undefined or null.

	// add new beach section as successor of matching node
	this._insertBeachsection(lArc, newArc);

	// cases:
	//

	// [null,null]
	// least likely case: new beach section is the first beach section on the
	// beachline.
	// This case means:
	//   no new transition appears
	//   no collapsing beach section
	//   new beachsection become root of the RB-tree
	if (!lArc && !rArc) {return;}

	// [lArc,rArc] where lArc == rArc
	// most likely case: new beach section split an existing beach
	// section.
	// This case means:
	//   one new transition appears
	//   the left and right beach section might be collapsing as a result
	//   two new nodes added to the RB-tree
	if (lArc === rArc) {
		// invalidate circle event of split beach section
		this.voidCircleEvent(lArc);

		// split the beach section into two separate beach sections
		rArc = this.createBeachsection(lArc.site);
		this._insertBeachsection(newArc, rArc);

		// since we have a new transition between two beach sections,
		// a new edge is born
		newArc.edge = rArc.edge = this.createEdge(lArc.site, newArc.site);

		// check whether the left and right beach sections are collapsing
		// and if so create circle events, to be notified when the point of
		// collapse is reached.
		this.addCircleEvent(lArc);
		this.addCircleEvent(rArc);
		return;
		}

	// [lArc,null]
	// even less likely case: new beach section is the *last* beach section
	// on the beachline -- this can happen *only* if *all* the previous beach
	// sections currently on the beachline share the same y value as
	// the new beach section.
	// This case means:
	//   one new transition appears
	//   no collapsing beach section as a result
	//   new beach section become right-most node of the RB-tree
	if (lArc && !rArc) {
		newArc.edge = this.createEdge(lArc.site,newArc.site);
		return;
		}

	// [null,rArc]
	// impossible case: because sites are strictly processed from top to bottom,
	// and left to right, which guarantees that there will always be a beach section
	// on the left -- except of course when there are no beach section at all on
	// the beach line, which case was handled above.
	// rhill 2011-06-02: No point testing in non-debug version
	//if (!lArc && rArc) {
	//	throw "Voronoi.addBeachsection(): What is this I don't even";
	//	}

	// [lArc,rArc] where lArc != rArc
	// somewhat less likely case: new beach section falls *exactly* in between two
	// existing beach sections
	// This case means:
	//   one transition disappears
	//   two new transitions appear
	//   the left and right beach section might be collapsing as a result
	//   only one new node added to the RB-tree
	if (lArc !== rArc) {
		// invalidate circle events of left and right sites
		this.voidCircleEvent(lArc);
		this.voidCircleEvent(rArc);

		// an existing transition disappears, meaning a vertex is defined at
		// the disappearance point
		var vertex = this.circumcircleCenter(lArc.site, site, rArc.site);
		this.setEdgeStartpoint(rArc.edge, lArc.site, rArc.site, vertex);

		// two new transitions appear at the new vertex location
		newArc.edge = this.createEdge(lArc.site, newArc.site, undefined, vertex);
		rArc.edge = this.createEdge(newArc.site, rArc.site, undefined, vertex);

		// check whether the left and right beach sections are collapsing
		// and if so create circle events, to handle the point of collapse.
		this.addCircleEvent(lArc);
		this.addCircleEvent(rArc);
		return;
		}
	};

Voronoi.prototype.circumcircleCenter = function(a,b,c) {
	// http://mathforum.org/library/drmath/view/55002.html
	// Except that I bring the origin at A to simplify
	// calculation
	var ax=a.x,
		ay=a.y,
		bx=b.x-ax,
		by=b.y-ay,
		cx=c.x-ax,
		cy=c.y-ay,
		d=2*(bx*cy-by*cx),
		hb=bx*bx+by*by,
		hc=cx*cx+cy*cy,
		x=(cy*hb-by*hc)/d,
		y=(bx*hc-cx*hb)/d;
	return {x:x+ax, y:y+ay};
	};

Voronoi.prototype.addCircleEvent = function(arc) {
	var lArc = arc.previous,
		rArc = arc.next;
	if (!lArc || !rArc) {return;} // does that ever happen?
	var lSite = lArc.site,
		cSite = arc.site,
		rSite = rArc.site;

	// If site of left beachsection is same as site of
	// right beachsection, there can't be convergence
	if (lSite===rSite) {return;}

	// Find the circumscribed circle for the three sites associated
	// with the beachsection triplet.
	// rhill 2011-05-26: It is more efficient to calculate in-place
	// rather than getting the resulting circumscribed circle from an
	// object returned by calling Voronoi.circumcircle()
	// http://mathforum.org/library/drmath/view/55002.html
	// Except that I bring the origin at cSite to simplify calculations.
	// The bottom-most part of the circumcircle is our Fortune 'circle
	// event', and its center is a vertex potentially part of the final
	// Voronoi diagram.
	var bx = cSite.x,
		by = cSite.y,
		ax = lSite.x-bx,
		ay = lSite.y-by,
		cx = rSite.x-bx,
		cy = rSite.y-by;

	// If points l->c->r are clockwise, then center beach section does not
	// collapse, hence it can't end up as a vertex (we reuse 'd' here, which
	// sign is reverse of the orientation, hence we reverse the test.
	// http://en.wikipedia.org/wiki/Curve_orientation#Orientation_of_a_simple_polygon
	// rhill 2011-05-21: Nasty finite precision error which caused circumcircle() to
	// return infinites: 1e-12 seems to fix the problem.
	var d = 2*(ax*cy-ay*cx);
	if (d >= -2e-12){return;}

	var	ha = ax*ax+ay*ay,
		hc = cx*cx+cy*cy,
		x = (cy*ha-ay*hc)/d,
		y = (ax*hc-cx*ha)/d,
		ycenter = y+by;

	// Important: ybottom should always be under or at sweep, so no need
	// to waste CPU cycles by checking
	arc.circleEvent = {
		type: this.CIRCLE_EVENT,
		arc: arc,
		site: cSite,
		x: x+bx,
		y: ycenter+this.sqrt(x*x+y*y), // y bottom
		ycenter: ycenter
		};
	this.queuePushCircle(arc.circleEvent);
	};

Voronoi.prototype.voidCircleEvent = function(arc) {
	if (arc.circleEvent) {
		arc.circleEvent.type = this.VOID_EVENT;
		arc.circleEvent = null;
		}
	};

// get rid of void events from the circle events queue
Voronoi.prototype.queueSanitize = function() {
	// ideally, the circle events queue should have *less*
	// circle events as there are beach sections on the
	// beachline -- all beach sections *cannot* be collapsing all at
	// the same time.
	// but void events other than at the end accumulate and cause
	// the finding of insertion point for new circle events to
	// take longer and longer -- even though a binary search is used.
	// to remedy this, a threshold is used to clean up the circle
	// events queue from void events.
	// currently, I arbitrarily set the treshold at more than twice
	// the number of beach sections on the beachline.
	// Important: VOID_EVENT must be defined so that Boolean(VOID_EVENT)
	// is false.
	// rhill 2011-05-27: splice() from start, as the farther a circle
	// event is from the sweep line, the more likely it has been voided.
	var q = this.circEvents,
		qlen = q.length,
		nArcs = this.numBeachsections;
	if (qlen < nArcs*2) {return;}
	var iLeft = 0, iRight = 0;
	// move to first non-void event
	while (iRight<qlen && !q[iRight].type) {iRight++;}
	q.splice(iLeft, iRight-iLeft);
	qlen = q.length;
	while (true) {
		// skip non-void events
		while (iLeft<qlen && q[iLeft].type) {iLeft++;}
		if (iLeft===qlen) {break;}
		// find a left-most non-void event immediately to the right of iLeft
		iRight = iLeft+1;
		while (iRight<qlen && !q[iRight].type) {iRight++;}
		q.splice(iLeft, iRight-iLeft);
		qlen = q.length;
		// abort if queue has gotten small enough, this allow
		// to avoid having to go through the whole array, most
		// circle events are added toward the end of the queue
		if (qlen < nArcs) {return;}
		}
	};

Voronoi.prototype.queuePopSite = function() {
	var site = this.siteEvents.pop();
	return {type:this.SITE_EVENT, x:site.x, y:site.y, site:site};
	};

Voronoi.prototype.queuePop = function() {
	// we will return a site or circle event
	var siteEvent = this.siteEvents.length > 0 ? this.siteEvents[this.siteEvents.length-1] : null,
		circEvent = this.circEvents.length > 0 ? this.circEvents[this.circEvents.length-1] : null;
	// if one and only one is null, the other is a valid event
	if ( !siteEvent !== !circEvent ) {
		return siteEvent ? this.queuePopSite() : this.circEvents.pop();
		}
	// both queues are empty
	if (!siteEvent) {
		return null;
		}
	// both queues have valid events, return 'earliest'
	if (siteEvent.y < circEvent.y || (siteEvent.y === circEvent.y && siteEvent.x < circEvent.x)) {
		return this.queuePopSite();
		}
	return this.circEvents.pop();
	};

// rhill 2011-05-17:
//   Using Array.sort() after an Array.push() is out of question,
//   horrible exponential decrease in performance -- expected, but
//   I wanted to confirm. Confirmed.
Voronoi.prototype.queuePushCircle = function(o) {
	var q = this.circEvents,
		r = q.length;
	if (r) {
		var l = 0, i, c;
		while (l<r) {
			i = (l+r)>>1;
			c = o.y-q[i].y;
			if (!c) {c = o.x-q[i].x;}
			if (c>0) {r = i;}
			else {l = i+1;}
			}
		q.splice(l,0,o);
		}
	else {
		q.push(o);
		}
	};

Voronoi.prototype.getBisector = function(va, vb) {
	var r = {x:(va.x+vb.x)/2, y:(va.y+vb.y)/2};
	if (vb.y===va.y) {return r;}
	r.m = (va.x-vb.x)/(vb.y-va.y);
	r.b = r.y-r.m*r.x;
	return r;
	};

// connect dangling edges (not if a cursory test tells us
// it is not going to be visible.
// return value:
//   false: the dangling endpoint couldn't be connected
//   true: the dangling endpoint could be connected
Voronoi.prototype.connectEdge = function(edge, bbox) {
	// skip if end point already connected
	var vb = edge.vb;
	if (!!vb) {return true;}

	// make local copy for performance purpose
	var va = edge.va,
		xl = bbox.xl,
		xr = bbox.xr,
		yt = bbox.yt,
		yb = bbox.yb,
		lSite = edge.lSite,
		rSite = edge.rSite,
		f = this.getBisector(lSite, rSite); // get the line formula of the bisector

	// remember, direction of line (relative to left site):
	// upward: left.x < right.x
	// downward: left.x > right.x
	// horizontal: left.x == right.x
	// upward: left.x < right.x
	// rightward: left.y < right.y
	// leftward: left.y > right.y
	// vertical: left.y == right.y

	// depending on the direction, find the best side of the
	// bounding box to use to determine a reasonable start point

	// special case: vertical line
	if (f.m === undefined) {
		// doesn't intersect with viewport
		if (f.x < xl || f.x >= xr) {return false;}
		// downward
		if (lSite.x > rSite.x) {
			if (!va) {
				va = {x:f.x, y:yt};
				}
			else if (va.y >= yb) {
				return false;
				}
			vb = {x:f.x, y:yb};
			}
		// upward
		else {
			if (!va) {
				va = {x:f.x, y:yb};
				}
			else if (va.y < yt) {
				return false;
				}
			vb = {x:f.x, y:yt};
			}
		}
	// closer to horizontal than vertical, connect start point to the
	// left or right side of the bounding box
	else if (f.m < 1) {
		// rightward
		if (lSite.y < rSite.y) {
			if (!va) {
				va = {x:xl, y:f.m*xl+f.b};
				}
			else if (va.x >= xr) {
				return false;
				}
			vb = {x:xr, y:f.m*xr+f.b};
			}
		// leftward
		else {
			if (!va) {
				va = {x:xr, y:f.m*xr+f.b};
				}
			else if (va.x < xl) {
				return false;
				}
			vb = {x:xl, y:f.m*xl+f.b};
			}
		}
	// closer to vertical than horizontal, connect start point to the
	// top or bottom side of the bounding box
	else {
		// downward
		if (lSite.x > rSite.x) {
			if (!va) {
				va = {x:(yt-f.b)/f.m, y:yt};
				}
			else if (va.y >= yb) {
				return false;
				}
			vb = {x:(yb-f.b)/f.m, y:yb};
			}
		// upward
		else {
			if (!va) {
				va = {x:(yb-f.b)/f.m, y:yb};
				}
			else if (va.y < yt) {
				return false;
				}
			vb = {x:(yt-f.b)/f.m, y:yt};
			}
		}
	edge.va = va;
	edge.vb = vb;
	return true;
	};

// line-clipping code taken from:
//   Liang-Barsky function by Daniel White
//   http://www.skytopia.com/project/articles/compsci/clipping.html
// Thanks!
// A bit modified to minimize code paths
Voronoi.prototype.clipEdge = function(edge, bbox) {
	var ax = edge.va.x,
		ay = edge.va.y,
		bx = edge.vb.x,
		by = edge.vb.y,
		t0 = 0,
		t1 = 1,
		dx = bx-ax,
		dy = by-ay;
	// left
	var q = ax-bbox.xl;
	if (dx===0 && q<0) {return false;}
	var r = -q/dx;
	if (dx<0) {
		if (r<t0) {return false;}
		else if (r<t1) {t1=r;}
		}
	else if (dx>0) {
		if (r>t1) {return false;}
		else if (r>t0) {t0=r;}
		}
	// right
	q = bbox.xr-ax;
	if (dx===0 && q<0) {return false;}
	r = q/dx;
	if (dx<0) {
		if (r>t1) {return false;}
		else if (r>t0) {t0=r;}
		}
	else if (dx>0) {
		if (r<t0) {return false;}
		else if (r<t1) {t1=r;}
		}
	// top
	q = ay-bbox.yt;
	if (dy===0 && q<0) {return false;}
	r = -q/dy;
	if (dy<0) {
		if (r<t0) {return false;}
		else if (r<t1) {t1=r;}
		}
	else if (dy>0) {
		if (r>t1) {return false;}
		else if (r>t0) {t0=r;}
		}
	// bottom		
	q = bbox.yb-ay;
	if (dy===0 && q<0) {return false;}
	r = q/dy;
	if (dy<0) {
		if (r>t1) {return false;}
		else if (r>t0) {t0=r;}
		}
	else if (dy>0) {
		if (r<t0) {return false;}
		else if (r<t1) {t1=r;}
		}

	// if we reach this point, Voronoi edge is within bbox

	// if t0 > 0, va needs to change
	// rhill 2011-06-03: we need to create a new vertex rather
	// than modifiying the existing one, since the existing
	// one is likely shared with at least another edge
	if (t0 > 0) {
		edge.va = {x:ax+t0*dx, y:ay+t0*dy};
		}

	// if t1 < 1, vb needs to change
	// rhill 2011-06-03: we need to create a new vertex rather
	// than modifiying the existing one, since the existing
	// one is likely shared with at least another edge
	if (t1 < 1) {
		edge.vb = {x:ax+t1*dx, y:ay+t1*dy};
		}

	return true;
	};

// Cut edges at bounding box
Voronoi.prototype.clipEdges = function(bbox) {
	// connect all dangling edges to bounding box
	// or get rid of them if it can't be done
	var edges = this.edges,
		iEdge = edges.length,
		edge;
	// iterate backward so we can splice safely and efficiently
	while (iEdge--) {
		edge = edges[iEdge];
		if (!this.connectEdge(edge, bbox) || !this.clipEdge(edge, bbox) || this.verticesAreEqual(edge.va, edge.vb)) {
			edge.va = edge.vb = null;
			edges.splice(iEdge,1);
			}
		}
	};

// Close the cells.
// The cells are bound by the supplied bounding box.
// Each cell refers to its associated site, and a list
// of halfedges ordered counterclockwise.
Voronoi.prototype.closeCells = function(bbox) {
	// clip edges to bounding box
	this.clipEdges(bbox);
	// prune and order halfedges
	var xl = bbox.xl,
		xr = bbox.xr,
		yt = bbox.yt,
		yb = bbox.yb,
		cells = this.cells,
		iCell = cells.length,
		cell,
		iLeft, iRight,
		halfedges, nHalfedges,
		edge,
		startpoint, endpoint,
		va, vb;
	while (iCell--) {
		cell = cells[iCell];
		// trim non fully-defined halfedges and sort them counterclockwise
		if (!cell.prepare()) {
			continue;
			}
		// close open cells
		// step 1: find first 'unclosed' point, if any.
		// an 'unclosed' point will be the end point of a halfedge which
		// does not match the start point of the following halfedge
		halfedges = cell.halfedges;
		nHalfedges = halfedges.length;
		// special case: only one site, in which case, the viewport is the cell
		// ...
		// all other cases
		iLeft = 0;
		while (iLeft < nHalfedges) {
			iRight = (iLeft+1) % nHalfedges;
			endpoint = halfedges[iLeft].getEndpoint();
			startpoint = halfedges[iRight].getStartpoint();
//			if (!this.verticesAreEqual(endpoint,startpoint)) {
			if (this.abs(endpoint.x-startpoint.x)>=1e-9 || this.abs(endpoint.y-startpoint.y)>=1e-9) {
				// if we reach this point, cell needs to be closed by walking
				// counterclockwise along the bounding box until it connects
				// to next halfedge in the list
				va = endpoint;
				// walk downward along left side
				if (this.equalWithEpsilon(endpoint.x,xl) && this.lessThanWithEpsilon(endpoint.y,yb)) {
					vb = {
						x: xl,
						y: this.equalWithEpsilon(startpoint.x,xl) ? startpoint.y : yb
						};
					}
				// walk rightward along bottom side
				else if (this.equalWithEpsilon(endpoint.y,yb) && this.lessThanWithEpsilon(endpoint.x,xr)) {
					vb = {
						x: this.equalWithEpsilon(startpoint.y,yb) ? startpoint.x : xr,
						y: yb
						};
					}
				// walk upward along right side
				else if (this.equalWithEpsilon(endpoint.x,xr) && this.greaterThanWithEpsilon(endpoint.y,yt)) {
					vb = {
						x: xr,
						y: this.equalWithEpsilon(startpoint.x,xr) ? startpoint.y : yt
						};
					}
				// walk leftward along top side
				else if (this.equalWithEpsilon(endpoint.y,yt) && this.greaterThanWithEpsilon(endpoint.x,xl)) {
					vb = {
						x: this.equalWithEpsilon(startpoint.y,yt) ? startpoint.x : xl,
						y: yt
						};
					}
				edge = this.createBorderEdge(cell.site, va, vb);
				halfedges.splice(iLeft+1, 0, new this.Halfedge(edge, cell.site, null));
				nHalfedges = halfedges.length;
				}
			iLeft++;
			}
		}
	};

// rhill 2011-05-19:
//   Voronoi sites are kept client-side now, to allow
//   user to freely modify content. At compute time,
//   *references* to sites are copied locally.
Voronoi.prototype.compute = function(sites, bbox) {
	// to measure execution time
	var startTime = new Date();

	// Initialize array of Voronoi cells
	this.cells = [];
	var iSite = sites.length,
		site;
	while (iSite--) {
		site = sites[iSite];
		site.voronoiId = iSite;
		this.cells[iSite] = new this.Cell(site);
		}

	// init internal state
	this.resetBeachline();
	this.edges = [];
	this.circEvents = [];

	// Initialize site event queue
	this.siteEvents = sites.slice(0);
	this.siteEvents.sort(function(a,b){
		var r = b.y - a.y;
		if (r) {return r;}
		return b.x - a.x;
		});

	// process event queue
	var event,
		xsitex = Number.MIN_VALUE,
		xsitey = Number.MIN_VALUE;
	for (;;) {
		// next event
		event = this.queuePop();
		if (!event) {break;}

		// add beach section
		if (event.type === this.SITE_EVENT) {
			site = event.site;
			if (site.x !== xsitex || site.y !== xsitey) {
				this.addBeachsection(site);
				xsitey = site.y;
				xsitex = site.x;
				}
			//this.beachline.dump(event.y);
			}
		// remove beach section
		else if (event.type === this.CIRCLE_EVENT) {
			this.removeBeachsection(event);
			//this.beachline.dump(event.y);
			}
		// void event, sanitize queue
		else {
			this.queueSanitize();
			}
		}

	// wrap-up: discard edges completely outside bounding box,
	// truncate edges crossing bounding box, then close all open cells
	this.closeCells(bbox);

	// to measure execution time
	var stopTime = new Date();

	// prepare return values
	var result = {
		cells: this.cells,
		edges: this.edges,
		execTime: stopTime.getTime()-startTime.getTime()
		};

	// clean up
	this.resetBeachline();
	this.edges = null;
	this.cells = null;

	return result;
	};
