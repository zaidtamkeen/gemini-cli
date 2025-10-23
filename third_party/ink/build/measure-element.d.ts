import { type DOMElement } from './dom.js';
type Output = {
    /**
    Element width.
    */
    width: number;
    /**
    Element height.
    */
    height: number;
};
/**
Measure the dimensions of a particular `<Box>` element.
*/
declare const measureElement: (node: DOMElement) => Output;
/**
 * Get an element's inner width.
 */
export declare const getInnerWidth: (node: DOMElement) => number;
export declare const getInnerHeight: (node: DOMElement) => number;
/**
 * Get an element's position and dimensions relative to the root.
 */
export declare const getBoundingBox: (node: DOMElement) => {
    x: number;
    y: number;
    width: number;
    height: number;
};
/**
 * The entire height of an elements content.
 */
export declare const getScrollHeight: (node: DOMElement) => number;
/**
 * The entire width of an elements content.
 */
export declare const getScrollWidth: (node: DOMElement) => number;
export default measureElement;
